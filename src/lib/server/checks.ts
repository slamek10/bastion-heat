/**
 * Every minute: rooms that would do well with airing (too humid with a
 * drier outside, or high CO₂) and rooms or spots that are getting cold.
 * Cold is told after ten minutes and again when it's over; airing at most
 * once in three hours per room. The page gets the current list.
 */
import { loadSettings, read, write } from '$lib/server/store';
import { getState } from '$lib/server/ha';
import { currentRooms } from '$lib/server/heat';
import { publish } from '$lib/server/bus';
import { sendNotification } from '$lib/server/notify';
import { airingAdvice, tooCold } from '$lib/comfort';
import { numberOf, temperatureOf } from '$lib/rooms';
import { translate, type Key } from '$lib/i18n';
import type { Alert, Settings } from '$lib/types';

const COLD_GRACE = 10 * 60_000;
const AIRING_REPEAT = 3 * 3_600_000;

interface State {
	started: boolean;
	alerts: Map<string, Alert & { told: boolean }>;
	airingToldAt: Map<string, number>;
}
const global = globalThis as unknown as { __heatChecks?: State };
const state: State = (global.__heatChecks ??= {
	started: false,
	alerts: new Map(),
	airingToldAt: new Map()
});

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

export async function findAlerts(): Promise<Omit<Alert, 'since'>[]> {
	const settings = await loadSettings();
	const found: Omit<Alert, 'since'>[] = [];
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
	return found;
}

export interface LoggedAlert {
	key: string;
	kind: Alert['kind'];
	name: string;
	at: number;
}

/** every alert that started, for the weekly report; the last 2000 */
async function logAlerts(alerts: Omit<Alert, 'since'>[], at: number) {
	const log = await read<LoggedAlert[]>('alert-log.json', []);
	log.push(...alerts.map(({ key, kind, name }) => ({ key, kind, name, at })));
	await write('alert-log.json', log.slice(-2000));
}

export const alertLog = () => read<LoggedAlert[]>('alert-log.json', []);

async function tell(alert: Alert, over: boolean) {
	const settings = await loadSettings();
	if (!settings.notifyServices.length) return;
	const key = (over ? `${alert.message}_over` : alert.message) as Key;
	await sendNotification(settings.notifyServices, {
		title: translate(
			settings.locale,
			alert.kind === 'cold' ? 'alert_cold_title' : 'alert_airing_title',
			{ name: alert.name }
		),
		message: translate(settings.locale, key, alert.vars),
		tag: `bastion-heat-${alert.key}`,
		urgent: alert.kind === 'cold' && !over
	}).catch(() => {});
}

async function round() {
	const now = Date.now();
	const found = await findAlerts();
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
		if (alert.told && alert.kind === 'cold') await tell(alert, true);
	}
	for (const alert of state.alerts.values()) {
		if (alert.told) continue;
		if (alert.kind === 'cold' && now - alert.since >= COLD_GRACE) {
			alert.told = true;
			await tell(alert, false);
		}
		if (
			alert.kind === 'airing' &&
			now - (state.airingToldAt.get(alert.key) ?? 0) >= AIRING_REPEAT
		) {
			alert.told = true;
			state.airingToldAt.set(alert.key, now);
			await tell(alert, false);
		}
	}
	publish({ kind: 'alerts', alerts: currentAlerts() });
}

export const currentAlerts = (): Alert[] =>
	[...state.alerts.values()].map(({ told: _told, ...alert }) => alert);

export function startChecks() {
	if (state.started || process.env.CHECKS === 'off') return;
	state.started = true;
	setTimeout(() => round().catch(() => {}), 20_000);
	setInterval(
		() => round().catch((error) => console.warn('[checks]', (error as Error).message)),
		60_000
	).unref?.();
}
