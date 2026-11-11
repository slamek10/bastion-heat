/**
 * What Heat watches in Home Assistant (every entity of the settings), the
 * rooms as they are now, and the summary it writes back to HA for Bastion
 * HA's card (sensor.bastion_heat_summary), every minute.
 */
import { loadSettings } from '$lib/server/store';
import { publish } from '$lib/server/bus';
import { getState, haReady, setHaState, setWatched, watchedStates } from '$lib/server/ha';
import { houseTemperature, roomReading, zoneFor } from '$lib/rooms';
import type { Settings } from '$lib/types';

export function entitiesOf(settings: Settings) {
	const ids = new Set<string>(Object.values(settings.entities).filter(Boolean) as string[]);
	for (const room of settings.rooms) {
		for (const id of [...room.sensors, ...room.trvs, ...room.windows]) ids.add(id);
		if (room.ac) ids.add(room.ac);
		if (room.humidity) ids.add(room.humidity);
		if (room.co2) ids.add(room.co2);
	}
	for (const id of settings.frostSensors) ids.add(id);
	for (const preset of settings.presets)
		for (const target of preset.targets) ids.add(target.entity_id);
	return ids;
}

/** the climate entities the page may change: the zone, the AC, valves and preset targets */
export function controllable(settings: Settings) {
	const ids = new Set<string>();
	for (const id of [settings.entities.zone, settings.entities.ac]) if (id) ids.add(id);
	for (const room of settings.rooms) {
		for (const id of room.trvs) ids.add(id);
		if (room.ac) ids.add(room.ac);
	}
	for (const preset of settings.presets)
		for (const target of preset.targets) ids.add(target.entity_id);
	return ids;
}

/**
 * The entities the page follows; their current states go out at once, so a
 * sensor just added to a room shows its value before it next changes.
 */
export async function refreshWatched() {
	setWatched(entitiesOf(await loadSettings()));
	publish({ kind: 'states', states: watchedStates() });
}

export async function currentRooms() {
	const settings = await loadSettings();
	const states = watchedStates();
	const now = Date.now();
	return settings.rooms.map((room) => ({
		room,
		reading: roomReading(
			room,
			states,
			now,
			settings.staleMinutes,
			zoneFor(room, settings.entities),
			states[settings.entities.zone]
		)
	}));
}

async function publishSummary() {
	if (!haReady()) return;
	const rooms = await currentRooms();
	const house = houseTemperature(rooms.map((entry) => entry.reading));
	const heating = rooms.filter((entry) => entry.reading.heating);
	await setHaState('sensor.bastion_heat_summary', house !== undefined ? String(house) : 'unknown', {
		friendly_name: 'Bastion Heat',
		unit_of_measurement: '°C',
		device_class: 'temperature',
		icon: 'mdi:radiator',
		heating: heating.length,
		rooms: rooms.map(({ room, reading }) => ({
			name: room.name,
			temperature: reading.value,
			target: reading.target,
			heating: reading.heating,
			window_open: reading.windowOpen
		})),
		outdoor: getState((await loadSettings()).entities.outdoor ?? '')?.state,
		url: (process.env.APP_URL || '').replace(/\/$/, '') || undefined
	});
}

const global = globalThis as unknown as { __heatSummary?: boolean };

export function startSummary() {
	// SUMMARY=off: nothing is written to HA (testing against a live HA)
	if (global.__heatSummary || process.env.SUMMARY === 'off') {
		refreshWatched();
		return;
	}
	global.__heatSummary = true;
	refreshWatched();
	setInterval(
		() => publishSummary().catch((error) => console.warn('[summary]', (error as Error).message)),
		60_000
	).unref?.();
	setTimeout(() => publishSummary().catch(() => {}), 15_000);
}
