/**
 * The heating's health from Home Assistant: each valve (its battery is
 * found on the same device through HA's entity registry), the Imou API
 * calls of the month (the integration's two counters), myVAILLANT's fault
 * and online sensors, and per room a week of heating: how fast it warms
 * and how long it heated. The week's figures are kept 15 minutes.
 */
import { loadSettings } from '$lib/server/store';
import { entityRegistry, getState, haReady, history } from '$lib/server/ha';
import { sentCommands } from '$lib/server/brain';
import {
	combine,
	heatRate,
	heatRuns,
	hoursOn,
	intersect,
	quotaOf,
	spansOf,
	union,
	valveHealth,
	type Edge,
	type Point,
	type Span
} from '$lib/health';
import { numberOf, zoneFor } from '$lib/rooms';
import type { Diagnostics, Room, RoomStats, Settings, ValveReport } from '$lib/types';

const objectId = (id: string) => id.slice(id.indexOf('.') + 1);

/** each valve's battery sensor: on the valve's device, else named after it */
async function batteries(trvs: string[]) {
	const registry = await entityRegistry();
	const byEntity = new Map(registry.map((entry) => [entry.entity_id, entry]));
	const out: Record<string, string | undefined> = {};
	for (const trv of trvs) {
		const device = byEntity.get(trv)?.device_id;
		const found = device
			? registry.find(
					(entry) =>
						entry.device_id === device &&
						entry.entity_id.startsWith('sensor.') &&
						getState(entry.entity_id)?.attributes?.device_class === 'battery'
				)
			: undefined;
		const guess = `sensor.${objectId(trv)}_battery`;
		out[trv] = found?.entity_id ?? (getState(guess) ? guess : undefined);
	}
	return out;
}

export async function valveReports(settings?: Settings): Promise<ValveReport[]> {
	settings ??= await loadSettings();
	const trvs = settings.rooms.flatMap((room) => room.trvs.map((trv) => ({ trv, room })));
	const battery = await batteries(trvs.map((entry) => entry.trv));
	const sent = await sentCommands();
	const now = Date.now();
	return trvs.map(({ trv, room }) => {
		const id = battery[trv];
		return valveHealth(
			trv,
			room.id,
			getState(trv),
			id ? getState(id) : undefined,
			sent[trv],
			settings.batteryLimit,
			now
		);
	});
}

/** the Imou integration's "API calls this month" and "API calls remaining" */
export async function quota() {
	const registry = await entityRegistry();
	const imou = registry.filter((entry) => entry.platform === 'imou_trv');
	const find = (suffix: string) =>
		imou.find((entry) => entry.unique_id?.endsWith(suffix))?.entity_id ??
		imou.find((entry) => entry.entity_id.endsWith(suffix))?.entity_id;
	const calls = find('_api_calls');
	const remaining = find('_api_calls_remaining');
	if (!calls || !remaining) return undefined;
	const used = numberOf(getState(calls));
	const left = numberOf(getState(remaining));
	if (used === undefined || left === undefined) return undefined;
	return quotaOf(used, left, new Date());
}

export interface BoilerProblem {
	entity: string;
	name: string;
	kind: 'fault' | 'offline';
}

/**
 * The boiler's own warnings: myVAILLANT's problem sensors that are on, its
 * connectivity sensors that are off, and the heating zone unavailable.
 */
export async function boilerProblems(settings: Settings): Promise<BoilerProblem[]> {
	const out: BoilerProblem[] = [];
	const registry = await entityRegistry();
	for (const entry of registry) {
		if (entry.platform !== 'mypyllant' || !entry.entity_id.startsWith('binary_sensor.')) continue;
		const state = getState(entry.entity_id);
		const kind = state?.attributes?.device_class;
		const name = state?.attributes?.friendly_name ?? entry.entity_id;
		if (kind === 'problem' && state?.state === 'on')
			out.push({ entity: entry.entity_id, name, kind: 'fault' });
		if (kind === 'connectivity' && state?.state === 'off')
			out.push({ entity: entry.entity_id, name, kind: 'offline' });
	}
	const zone = getState(settings.entities.zone);
	if (zone?.state === 'unavailable')
		out.push({
			entity: settings.entities.zone,
			name: zone.attributes?.friendly_name ?? settings.entities.zone,
			kind: 'offline'
		});
	return out;
}

type Row = { s: string; a?: Record<string, any>; lu?: number; lc?: number };

const HEATING = new Set(['heating', 'preheating']);

/** HA's history rows of a climate entity: on while its hvac_action is heating */
export function heatingEdges(rows: Row[], valve: boolean): { edges: Edge[]; hasAction: boolean } {
	let attributes: Record<string, any> = {};
	let hasAction = false;
	const edges: Edge[] = [];
	for (const row of rows) {
		if (row.a) attributes = row.a;
		const seconds = row.lu ?? row.lc;
		if (typeof seconds !== 'number') continue;
		const action = attributes.hvac_action;
		if (action !== undefined && action !== null) hasAction = true;
		const on =
			row.s !== 'off' &&
			row.s !== 'unavailable' &&
			(HEATING.has(action) ||
				(valve && row.s === 'heat' && (action === undefined || action === null)));
		edges.push({ t: seconds * 1000, on });
	}
	return { edges, hasAction };
}

/** temperatures from history rows: climate entities by current_temperature */
export function temperaturePoints(id: string, rows: Row[]): Point[] {
	const climate = id.startsWith('climate.');
	let attributes: Record<string, any> = {};
	const out: Point[] = [];
	for (const row of rows) {
		if (row.a) attributes = row.a;
		const seconds = row.lu ?? row.lc;
		if (typeof seconds !== 'number') continue;
		const v = parseFloat(climate ? attributes.current_temperature : row.s);
		if (Number.isFinite(v)) out.push({ t: seconds * 1000, v });
	}
	return out;
}

/** what heats the room: its valves, else the main zone when its thermostat is here, else its AC */
function heatersOf(room: Room, settings: Settings) {
	if (room.trvs.length) return { ids: room.trvs, valves: true };
	const zone = zoneFor(room, settings.entities);
	if (zone) return { ids: [zone], valves: false };
	if (room.ac) return { ids: [room.ac], valves: false };
	return { ids: [], valves: false };
}

const DAYS = 7;
const cache = globalThis as unknown as { __heatStats?: { at: number; rooms: RoomStats[] } };

/** a week of heating per room */
export async function roomStats(settings: Settings): Promise<RoomStats[]> {
	const cached = cache.__heatStats;
	if (cached && Date.now() - cached.at < 15 * 60_000) return cached.rooms;
	if (!haReady()) return cached?.rooms ?? [];
	const end = Date.now();
	const start = end - DAYS * 86_400_000;
	const climates = new Set<string>([settings.entities.zone]);
	const sensors = new Set<string>();
	for (const room of settings.rooms) {
		for (const id of heatersOf(room, settings).ids) climates.add(id);
		for (const id of room.sensors) (id.startsWith('climate.') ? climates : sensors).add(id);
	}
	const [heatRows, tempRows] = await Promise.all([
		history([...climates], new Date(start), new Date(end)),
		sensors.size ? history([...sensors], new Date(start), new Date(end)) : Promise.resolve({})
	]);
	const rows: Record<string, Row[]> = { ...tempRows, ...heatRows };

	// a valve heats only while the central heating does (when the zone says so)
	const central = heatingEdges(rows[settings.entities.zone] ?? [], false);
	const centralSpans = central.hasAction ? spansOf(central.edges, end) : undefined;

	const out = settings.rooms.map((room): RoomStats => {
		const heaters = heatersOf(room, settings);
		let spans: Span[] = union(
			heaters.ids.map((id) => spansOf(heatingEdges(rows[id] ?? [], heaters.valves).edges, end))
		);
		if (heaters.valves && centralSpans) spans = intersect(spans, centralSpans);
		const temps = combine(
			room.sensors.map((id) => temperaturePoints(id, rows[id] ?? [])),
			start,
			end
		);
		const runs = heatRuns(temps, spans);
		const rate = heatRate(runs);
		return {
			roomId: room.id,
			...(rate !== undefined && { rate }),
			runs: runs.filter((run) => run.rise > 0).length,
			hours24: hoursOn(spans, end - 86_400_000, end),
			hoursDay: Math.round((hoursOn(spans, start, end) / DAYS) * 10) / 10
		};
	});
	cache.__heatStats = { at: Date.now(), rooms: out };
	return out;
}

export async function diagnostics(): Promise<Diagnostics> {
	const settings = await loadSettings();
	const [valves, calls, rooms] = await Promise.all([
		valveReports(settings),
		quota(),
		roomStats(settings).catch((error) => {
			console.warn('[health] history:', (error as Error).message);
			return [] as RoomStats[];
		})
	]);
	return { valves, ...(calls && { quota: calls }), rooms, at: Date.now() };
}
