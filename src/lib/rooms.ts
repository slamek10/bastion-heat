/**
 * A room's temperature from several sensors: each one read (a climate
 * entity's current_temperature, a sensor's state), the ones too old or
 * unavailable left out, the rest combined (mean, median or the lowest).
 * Shared by the page and the server.
 */
import type { Aggregation, HaState, Room, RoomReading, SensorReading } from '$lib/types';

export function numberOf(state: HaState | undefined, attribute?: string): number | undefined {
	if (!state) return undefined;
	const raw = attribute ? state.attributes?.[attribute] : state.state;
	const value = typeof raw === 'number' ? raw : parseFloat(raw);
	return Number.isFinite(value) ? value : undefined;
}

/** the temperature an entity reports: climate entities in current_temperature */
export const temperatureOf = (state: HaState | undefined) =>
	state?.entity_id.startsWith('climate.')
		? numberOf(state, 'current_temperature')
		: numberOf(state);

/** when it last said anything: last_reported moves with every report, also an unchanged value */
export function lastHeard(state: HaState) {
	const time = Date.parse(state.last_reported ?? state.last_updated ?? state.last_changed ?? '');
	return Number.isFinite(time) ? time : undefined;
}

export function readSensor(
	entity: string,
	state: HaState | undefined,
	now: number,
	staleMinutes: number
): SensorReading {
	const value = temperatureOf(state);
	const heard = state ? lastHeard(state) : undefined;
	const old = heard === undefined || now - heard > staleMinutes * 60_000;
	return { entity, value, stale: value === undefined || old };
}

export function aggregate(values: number[], method: Aggregation): number | undefined {
	if (!values.length) return undefined;
	let result: number;
	if (method === 'min') result = Math.min(...values);
	else if (method === 'median') {
		const sorted = [...values].sort((a, b) => a - b);
		const middle = Math.floor(sorted.length / 2);
		result = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
	} else result = values.reduce((sum, value) => sum + value, 0) / values.length;
	return Math.round(result * 10) / 10;
}

const HEATING_ACTIONS = new Set(['heating', 'preheating']);

export function roomReading(
	room: Room,
	states: Record<string, HaState>,
	now: number,
	staleMinutes: number,
	mainZone?: string
): RoomReading {
	const used = room.sensors.map((entity) => readSensor(entity, states[entity], now, staleMinutes));
	const fresh = used.filter((reading) => !reading.stale).map((reading) => reading.value!);
	const valves = room.trvs.map((entity) => states[entity]).filter(Boolean);
	const thermostats = valves
		.map((valve) => numberOf(valve, 'current_temperature'))
		.filter((v): v is number => v !== undefined);
	const targets = valves
		.map((valve) => numberOf(valve, 'temperature'))
		.filter((v): v is number => v !== undefined);
	const zone = mainZone ? states[mainZone] : undefined;
	// without valves the main zone heats every room
	const heating = valves.length
		? valves.some(
				(valve) =>
					HEATING_ACTIONS.has(valve.attributes?.hvac_action) ||
					(valve.state === 'heat' && valve.attributes?.hvac_action === undefined)
			)
		: !!zone && HEATING_ACTIONS.has(zone.attributes?.hvac_action);
	const windowOpen = room.windows.some((entity) => states[entity]?.state === 'on');
	return {
		roomId: room.id,
		value: aggregate(fresh, room.aggregation),
		used,
		thermostat: thermostats.length ? aggregate(thermostats, 'mean') : undefined,
		// the main zone's target belongs to the thermostat's room, not to a room without valves
		target: targets.length ? Math.max(...targets) : undefined,
		heating,
		byBoiler: !valves.length,
		humidity: room.humidity ? numberOf(states[room.humidity]) : undefined,
		windowOpen
	};
}

/** the house: the mean of the rooms that have a temperature */
export function houseTemperature(readings: RoomReading[]) {
	return aggregate(
		readings
			.map((reading) => reading.value)
			.filter((value): value is number => value !== undefined),
		'mean'
	);
}
