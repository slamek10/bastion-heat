/**
 * The weekly report's arithmetic: time spent heating and the time-weighted
 * target from a thermostat's history, a room's hourly temperature from its
 * sensors, and the tips that follow from the numbers.
 */
import { aggregate } from '$lib/rooms';
import type { StatRow } from '$lib/efficiency';
import type { Aggregation } from '$lib/types';

/** HA's compressed history row: state, attributes (when they change), last updated/changed in s */
export interface HistoryRow {
	s: string;
	a?: Record<string, any>;
	lu?: number;
	lc?: number;
}

/** [from, to, attributes] spans clipped to [start, end] */
function spans(rows: HistoryRow[], start: number, end: number) {
	const out: { from: number; to: number; state: string; attributes: Record<string, any> }[] = [];
	let attributes: Record<string, any> = {};
	const timed = rows
		.map((row) => {
			if (row.a) attributes = row.a;
			const seconds = row.lu ?? row.lc;
			return { at: typeof seconds === 'number' ? seconds * 1000 : start, state: row.s, attributes };
		})
		.sort((a, b) => a.at - b.at);
	timed.forEach((row, i) => {
		const from = Math.max(start, row.at);
		const to = Math.min(end, timed[i + 1]?.at ?? end);
		if (to > from) out.push({ from, to, state: row.state, attributes: row.attributes });
	});
	return out;
}

/** hours the thermostat was heating (hvac_action heating / preheating) */
export function heatingHours(rows: HistoryRow[], start: number, end: number) {
	const ms = spans(rows, start, end)
		.filter((span) => ['heating', 'preheating'].includes(span.attributes.hvac_action))
		.reduce((sum, span) => sum + span.to - span.from, 0);
	return Math.round((ms / 3_600_000) * 10) / 10;
}

/** the target over time, weighted by how long each held; off is left out */
export function meanTarget(rows: HistoryRow[], start: number, end: number) {
	let weight = 0;
	let sum = 0;
	for (const span of spans(rows, start, end)) {
		const target = Number(span.attributes.temperature);
		if (span.state === 'off' || !Number.isFinite(target)) continue;
		weight += span.to - span.from;
		sum += target * (span.to - span.from);
	}
	return weight ? Math.round((sum / weight) * 10) / 10 : undefined;
}

/** a room's hourly temperature from its sensors' hourly statistics, combined like the live value */
export function roomWeek(sensors: StatRow[][], method: Aggregation) {
	const hours = new Map<string, { mean: number[]; min: number[]; max: number[] }>();
	for (const rows of sensors) {
		for (const row of rows) {
			if (typeof row.mean !== 'number') continue;
			const key = String(row.start);
			const hour = hours.get(key) ?? { mean: [], min: [], max: [] };
			hour.mean.push(row.mean);
			hour.min.push(typeof row.min === 'number' ? row.min : row.mean);
			hour.max.push(typeof row.max === 'number' ? row.max : row.mean);
			hours.set(key, hour);
		}
	}
	const means = [...hours.values()]
		.map((hour) => aggregate(hour.mean, method))
		.filter((v): v is number => v !== undefined);
	if (!means.length) return undefined;
	const lows = [...hours.values()].map((hour) => aggregate(hour.min, method) ?? Infinity);
	const highs = [...hours.values()].map((hour) => aggregate(hour.max, method) ?? -Infinity);
	return {
		avg: Math.round((means.reduce((a, b) => a + b, 0) / means.length) * 10) / 10,
		min: Math.round(Math.min(...lows) * 10) / 10,
		max: Math.round(Math.max(...highs) * 10) / 10
	};
}

export interface RoomWeek {
	id: string;
	name: string;
	avg?: number;
	min?: number;
	max?: number;
	target?: number;
	heatingHours?: number;
	airing: number;
	cold: number;
}

export interface Tip {
	key: string;
	vars: Record<string, string>;
}

export function tips(
	rooms: RoomWeek[],
	energy: { perHdd?: number; previousPerHdd?: number },
	hours = 168
): Tip[] {
	const out: Tip[] = [];
	for (const room of rooms) {
		if (room.avg !== undefined && room.target !== undefined) {
			const diff = Math.round((room.avg - room.target) * 10) / 10;
			if (diff >= 1) out.push({ key: 'tip_too_warm', vars: { name: room.name, d: String(diff) } });
			else if (diff <= -1 && (room.heatingHours ?? 0) >= hours * 0.4)
				out.push({
					key: 'tip_struggles',
					vars: { name: room.name, d: String(-diff), h: String(room.heatingHours) }
				});
		}
		if (room.cold) out.push({ key: 'tip_cold', vars: { name: room.name, n: String(room.cold) } });
		if (room.airing >= 3)
			out.push({ key: 'tip_humid', vars: { name: room.name, n: String(room.airing) } });
	}
	if (energy.perHdd !== undefined && energy.previousPerHdd) {
		const change = Math.round(
			((energy.perHdd - energy.previousPerHdd) / energy.previousPerHdd) * 100
		);
		if (change >= 15) out.push({ key: 'tip_eff_worse', vars: { p: String(change) } });
		else if (change <= -15) out.push({ key: 'tip_eff_better', vars: { p: String(-change) } });
	}
	if (!out.length) out.push({ key: 'tip_all_good', vars: {} });
	return out;
}
