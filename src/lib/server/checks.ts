/**
 * Every minute, what's worth telling: rooms that would do well with airing
 * (too humid with a drier outside, or high CO₂), rooms or spots getting
 * cold, and the equipment: a valve offline or not taking its setpoint, a
 * low battery, water pressure out of range, the boiler's own faults, and a
 * room heating for two hours without getting warmer.
 *
 * Each kind waits its own time before the phone hears of it (a short dip
 * isn't news), some say when it's over, and none repeats within hours.
 * A notification has a "mute for a day" button. The page gets the list.
 */
import { loadSettings, read, write } from '$lib/server/store';
import { getState } from '$lib/server/ha';
import { currentRooms } from '$lib/server/heat';
import { publish } from '$lib/server/bus';
import { sendNotification } from '$lib/server/notify';
import { offer, onPhoneAction } from '$lib/server/phoneActions';
import { boilerProblems, valveReports } from '$lib/server/health';
import { airingAdvice, tooCold } from '$lib/comfort';
import { pressureState } from '$lib/curve';
import { stalled, trackWarming, type Warming } from '$lib/health';
import { numberOf, temperatureOf } from '$lib/rooms';
import { translate, type Key } from '$lib/i18n';
import type { Alert, AlertKind, Room, Settings } from '$lib/types';

const MIN = 60_000;
/** how long it has to last before the phone hears of it */
const GRACE: Partial<Record<AlertKind, number>> = {
	cold: 10 * MIN,
	pressure: 10 * MIN,
	boiler: 15 * MIN
};
/** not again within this long, even when it went away and came back */
const REPEAT: Record<AlertKind, number> = {
	airing: 3 * 60 * MIN,
	cold: 0,
	valve: 6 * 60 * MIN,
	battery: 24 * 60 * MIN,
	pressure: 6 * 60 * MIN,
	boiler: 6 * 60 * MIN,
	stalled: 6 * 60 * MIN
};
/** these also say when they're over */
const OVER = new Set<AlertKind>(['cold', 'valve', 'pressure', 'boiler']);
const URGENT = new Set<AlertKind>(['cold', 'pressure', 'boiler']);
const MUTE = 24 * 60 * MIN;

const TITLES: Record<AlertKind, Key> = {
	airing: 'alert_airing_title',
	cold: 'alert_cold_title',
	valve: 'alert_valve_title',
	battery: 'alert_battery_title',
	pressure: 'alert_pressure_title',
	boiler: 'alert_boiler_title',
	stalled: 'alert_stalled_title'
};

interface State {
	started: boolean;
	alerts: Map<string, Alert & { told: boolean }>;
	toldAt: Map<string, number>;
	/** rooms heating, since when and at what temperature */
	warming: Map<string, Warming>;
	muted?: Record<string, number>;
}
const global = globalThis as unknown as { __heatChecks?: State };
const state: State = (global.__heatChecks ??= {
	started: false,
	alerts: new Map(),
	toldAt: new Map(),
	warming: new Map()
});
// an older state from before a reload
state.toldAt ??= new Map();
state.warming ??= new Map();

async function muted() {
	state.muted ??= await read<Record<string, number>>('muted.json', {});
	const now = Date.now();
	for (const [key, until] of Object.entries(state.muted)) if (until <= now) delete state.muted[key];
	return state.muted;
}

/** no notifications for this alert for a day; it still shows on the page */
export async function mute(key: string) {
	const list = await muted();
	list[key] = Date.now() + MUTE;
	await write('muted.json', list);
}

/** outdoor temperature and humidity: a weather entity carries both, else the two sensors */
function outdoor(settings: Settings) {
	const humidityEntity = settings.entities.outdoorHumidity
		? getState(settings.entities.outdoorHumidity)
		: undefined;
	if (humidityEntity?.entity_id.startsWith('weather.')) {
		return {
			temperature: numberOf(humidityEntity, 'temperature'),
			humidity: numberOf(humidityEntity, 'humidity')
		};
	}
	return {
		temperature: numberOf(
			settings.entities.outdoor ? getState(settings.entities.outdoor) : undefined
		),
		humidity: numberOf(humidityEntity)
	};
}

/** "Dnevni boravak", or "Dnevni boravak · Ventil kod prozora" when the room has more than one */
function valveName(room: Room, trv: string) {
	if (room.trvs.length < 2) return room.name;
	const own = room.labels?.[trv] ?? getState(trv)?.attributes?.friendly_name ?? trv;
	return `${room.name} · ${own}`;
}

type Found = Omit<Alert, 'since'>;

async function equipment(settings: Settings, now: number): Promise<Found[]> {
	const found: Found[] = [];
	const rooms = new Map(settings.rooms.map((room) => [room.id, room]));
	for (const valve of await valveReports(settings)) {
		const room = rooms.get(valve.roomId);
		if (!room) continue;
		const name = valveName(room, valve.entity);
		if (valve.offline)
			found.push({
				key: `valve|${valve.entity}`,
				kind: 'valve',
				name,
				message: 'alert_valve_offline',
				vars: { name }
			});
		else if (valve.notResponding)
			found.push({
				key: `valve|${valve.entity}`,
				kind: 'valve',
				name,
				message: 'alert_valve_late',
				vars: {
					name,
					asked: String(valve.notResponding.asked),
					actual: String(valve.notResponding.actual ?? '—')
				}
			});
		if (valve.batteryLow)
			found.push({
				key: `battery|${valve.entity}`,
				kind: 'battery',
				name,
				message: 'alert_battery',
				vars: { name, b: String(valve.battery) }
			});
	}

	const bar = numberOf(
		settings.entities.pressure ? getState(settings.entities.pressure) : undefined
	);
	const pressure = pressureState(bar);
	if (pressure === 'low' || pressure === 'high')
		found.push({
			key: 'pressure',
			kind: 'pressure',
			name: translate(settings.locale, 'pressure_title'),
			message: pressure === 'low' ? 'alert_pressure_low' : 'alert_pressure_high',
			vars: { p: String(bar) }
		});

	for (const problem of await boilerProblems(settings))
		found.push({
			key: `boiler|${problem.entity}`,
			kind: 'boiler',
			name: problem.name,
			message: problem.kind === 'fault' ? 'alert_boiler_fault' : 'alert_boiler_offline',
			vars: { name: problem.name }
		});

	// a room that heats and doesn't get warmer
	const seen = new Set<string>();
	for (const { room, reading } of await currentRooms()) {
		seen.add(room.id);
		const warming = trackWarming(
			state.warming.get(room.id),
			reading.controlled && reading.heating && !reading.windowOpen,
			reading.value,
			now
		);
		if (warming) state.warming.set(room.id, warming);
		else state.warming.delete(room.id);
		if (stalled(warming, now))
			found.push({
				key: `stalled|${room.id}`,
				kind: 'stalled',
				name: room.name,
				message: 'alert_stalled',
				vars: {
					name: room.name,
					t: String(reading.value),
					h: String(Math.floor((now - warming!.since) / 3_600_000))
				}
			});
	}
	for (const id of state.warming.keys()) if (!seen.has(id)) state.warming.delete(id);
	return found;
}

export async function findAlerts(now = Date.now()): Promise<Found[]> {
	const settings = await loadSettings();
	const found: Found[] = [];
	const air = outdoor(settings);
	for (const { room, reading } of await currentRooms()) {
		if (settings.frostAlerts && tooCold(reading.value, settings.frostLimit)) {
			found.push({
				key: `cold|${room.id}`,
				kind: 'cold',
				name: room.name,
				message: 'alert_cold',
				vars: { name: room.name, t: String(reading.value) }
			});
		}
		if (!settings.airingAlerts) continue;
		const advice = airingAdvice(
			{
				temperature: reading.value,
				humidity: reading.humidity,
				co2: room.co2 ? numberOf(getState(room.co2)) : undefined,
				windowOpen: reading.windowOpen
			},
			air,
			{ humidity: settings.humidityLimit, co2: settings.co2Limit }
		);
		if (advice) {
			found.push({
				key: `airing|${room.id}`,
				kind: 'airing',
				name: room.name,
				message: advice.reason === 'co2' ? 'alert_airing_co2' : 'alert_airing_humidity',
				vars: {
					name: room.name,
					h: String(reading.humidity ?? ''),
					g: String(advice.value),
					ppm: String(advice.value)
				}
			});
		}
	}
	if (settings.frostAlerts) {
		for (const id of settings.frostSensors) {
			const entity = getState(id);
			const value = temperatureOf(entity);
			if (tooCold(value, settings.frostLimit)) {
				const name = entity?.attributes?.friendly_name ?? id;
				found.push({
					key: `cold|${id}`,
					kind: 'cold',
					name,
					message: 'alert_cold',
					vars: { name, t: String(value) }
				});
			}
		}
	}
	if (settings.healthAlerts) found.push(...(await equipment(settings, now)));
	return found;
}

export interface LoggedAlert {
	key: string;
	kind: Alert['kind'];
	name: string;
	at: number;
}

/** every alert that started, for the weekly report; the last 2000 */
async function logAlerts(alerts: Found[], at: number) {
	const log = await read<LoggedAlert[]>('alert-log.json', []);
	log.push(...alerts.map(({ key, kind, name }) => ({ key, kind, name, at })));
	await write('alert-log.json', log.slice(-2000));
}

export const alertLog = () => read<LoggedAlert[]>('alert-log.json', []);

async function tell(alert: Alert, over: boolean) {
	const settings = await loadSettings();
	if (!settings.notifyServices.length) return;
	if ((await muted())[alert.key]) return;
	const key = (over ? `${alert.message}_over` : alert.message) as Key;
	await sendNotification(settings.notifyServices, {
		title: translate(settings.locale, TITLES[alert.kind], { name: alert.name }),
		message: translate(settings.locale, key, alert.vars),
		tag: `bastion-heat-${alert.key}`,
		urgent: URGENT.has(alert.kind) && !over,
		...(!over &&
			alert.kind !== 'cold' && {
				actions: [
					{
						action: offer({ kind: 'mute', key: alert.key }),
						title: translate(settings.locale, 'mute_day')
					}
				]
			})
	}).catch(() => {});
}

async function round() {
	const now = Date.now();
	const found = await findAlerts(now);
	const keys = new Set(found.map((alert) => alert.key));
	const fresh = found.filter((alert) => !state.alerts.has(alert.key));
	if (fresh.length) await logAlerts(fresh, now);
	for (const alert of found) {
		const before = state.alerts.get(alert.key);
		state.alerts.set(alert.key, {
			...alert,
			since: before?.since ?? now,
			told: before?.told ?? false
		});
	}
	for (const [key, alert] of state.alerts) {
		if (keys.has(key)) continue;
		state.alerts.delete(key);
		if (alert.told && OVER.has(alert.kind)) await tell(alert, true);
	}
	for (const alert of state.alerts.values()) {
		if (alert.told) continue;
		if (now - alert.since < (GRACE[alert.kind] ?? 0)) continue;
		const last = state.toldAt.get(alert.key);
		if (last !== undefined && now - last < REPEAT[alert.kind]) continue;
		alert.told = true;
		state.toldAt.set(alert.key, now);
		await tell(alert, false);
	}
	publish({ kind: 'alerts', alerts: currentAlerts() });
}

export const currentAlerts = (): Alert[] =>
	[...state.alerts.values()].map(({ told: _told, ...alert }) => alert);

export function startChecks() {
	if (state.started || process.env.CHECKS === 'off') return;
	state.started = true;
	onPhoneAction(async (what) => {
		if (what.kind === 'mute') await mute(what.key);
	});
	setTimeout(() => round().catch(() => {}), 20_000);
	setInterval(
		() => round().catch((error) => console.warn('[checks]', (error as Error).message)),
		60_000
	).unref?.();
}
