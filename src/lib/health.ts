/**
 * How the heating is doing, as pure functions: each valve (battery, when it
 * last reported, offline, or not taking the brain's setpoint), the Imou API
 * calls of the month, and per room how fast it warms while it heats, how
 * long until its target and how long its valves were open. A room that has
 * been heating for hours without getting warmer is caught here too.
 */
import type { HaState } from '$lib/types';
import { lastHeard, numberOf } from '$lib/rooms';

/** a setpoint the brain sent and the valve still shows otherwise after this long: not answering */
export const RESPOND_MINUTES = 15;
/** unavailable this long: offline (the cloud drops a valve now and then for a minute) */
export const OFFLINE_MINUTES = 30;
/** heating this long without getting warmer: the room isn't warming */
export const STALL_MINUTES = 120;
/** what counts as getting warmer, °C */
export const STALL_RISE = 0.2;

export interface Sent {
	at: number;
	temp: number;
	/** only in the trial mode: nothing went to the valve */
	dry?: boolean;
}

export interface ValveHealth {
	entity: string;
	roomId: string;
	battery?: number;
	batteryLow: boolean;
	/** when it last reported anything, ms */
	lastSeen?: number;
	offline: boolean;
	/** the brain's setpoint that the valve hasn't taken */
	notResponding?: { asked: number; actual?: number; since: number };
}

export function valveHealth(
	entity: string,
	roomId: string,
	valve: HaState | undefined,
	battery: HaState | undefined,
	sent: Sent | undefined,
	batteryLimit: number,
	now: number
): ValveHealth {
	const level = numberOf(battery);
	const unavailable = !valve || valve.state === 'unavailable' || valve.state === 'unknown';
	const changed = valve ? Date.parse(valve.last_changed ?? '') : NaN;
	const offline =
		!valve ||
		(unavailable && (!Number.isFinite(changed) || now - changed >= OFFLINE_MINUTES * 60_000));
	const actual = numberOf(valve, 'temperature');
	const late =
		!!sent &&
		!sent.dry &&
		!unavailable &&
		now - sent.at >= RESPOND_MINUTES * 60_000 &&
		(actual === undefined || Math.abs(actual - sent.temp) >= 0.05);
	return {
		entity,
		roomId,
		...(level !== undefined && { battery: Math.round(level) }),
		batteryLow: level !== undefined && level <= batteryLimit,
		...(valve && lastHeard(valve) !== undefined && { lastSeen: lastHeard(valve) }),
		offline,
		...(late && { notResponding: { asked: sent!.temp, actual, since: sent!.at } })
	};
}

export interface Quota {
	calls: number;
	limit: number;
	/** by the end of the month at this month's rate; none in its first day */
	projected?: number;
	/** 0–1 */
	used: number;
}

/** the month's Imou API calls from the integration's two counters */
export function quotaOf(calls: number, remaining: number, now: Date): Quota | undefined {
	if (!Number.isFinite(calls) || !Number.isFinite(remaining)) return undefined;
	const limit = calls + Math.max(0, remaining);
	if (limit <= 0) return undefined;
	const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
	const elapsed = now.getTime() - start;
	return {
		calls,
		limit,
		...(elapsed >= 86_400_000 && { projected: Math.round((calls * (end - start)) / elapsed) }),
		used: Math.min(1, calls / limit)
	};
}

export interface Point {
	t: number;
	v: number;
}
export interface Span {
	from: number;
	to: number;
}
/** a moment from which something is on or off */
export interface Edge {
	t: number;
	on: boolean;
}

/** on/off moments into the stretches it was on, until `end` */
export function spansOf(edges: Edge[], end: number): Span[] {
	const sorted = [...edges].sort((a, b) => a.t - b.t);
	const out: Span[] = [];
	let start: number | undefined;
	for (const edge of sorted) {
		if (edge.on && start === undefined) start = edge.t;
		else if (!edge.on && start !== undefined) {
			if (edge.t > start) out.push({ from: start, to: edge.t });
			start = undefined;
		}
	}
	if (start !== undefined && end > start) out.push({ from: start, to: end });
	return out;
}

/** any of them on */
export function union(lists: Span[][]): Span[] {
	const all = lists.flat().sort((a, b) => a.from - b.from);
	const out: Span[] = [];
	for (const span of all) {
		const last = out.at(-1);
		if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
		else out.push({ ...span });
	}
	return out;
}

/** both on */
export function intersect(a: Span[], b: Span[]): Span[] {
	const out: Span[] = [];
	for (const x of a)
		for (const y of b) {
			const from = Math.max(x.from, y.from);
			const to = Math.min(x.to, y.to);
			if (to > from) out.push({ from, to });
		}
	return out.sort((p, q) => p.from - q.from);
}

/** the value at a moment: the last reading at or before it */
export function valueAt(points: Point[], at: number) {
	let found: number | undefined;
	for (const point of points) {
		if (point.t > at) break;
		found = point.v;
	}
	return found;
}

/**
 * Several sensors of a room into one line: every `step` the mean of each
 * sensor's last value (a sensor that hasn't reported yet is left out).
 */
export function combine(series: Point[][], start: number, end: number, step = 5 * 60_000) {
	const sorted = series.map((points) => [...points].sort((a, b) => a.t - b.t));
	const out: Point[] = [];
	for (let t = start; t <= end; t += step) {
		const values = sorted
			.map((points) => valueAt(points, t))
			.filter((v): v is number => v !== undefined);
		if (values.length)
			out.push({ t, v: values.reduce((sum, value) => sum + value, 0) / values.length });
	}
	return out;
}

export interface Run extends Span {
	/** °C from its start to its end */
	rise: number;
	/** °C per hour */
	rate: number;
}

/** each stretch of heating long enough to tell, with how much warmer the room got */
export function heatRuns(temps: Point[], spans: Span[], minMinutes = 30): Run[] {
	const out: Run[] = [];
	for (const span of spans) {
		const hours = (span.to - span.from) / 3_600_000;
		if (hours * 60 < minMinutes) continue;
		const start = valueAt(temps, span.from);
		const end = valueAt(temps, span.to);
		if (start === undefined || end === undefined) continue;
		const rise = Math.round((end - start) * 100) / 100;
		out.push({ ...span, rise, rate: Math.round((rise / hours) * 100) / 100 });
	}
	return out;
}

/** how fast the room warms while it heats: the median of the runs that warmed it */
export function heatRate(runs: Run[]) {
	const rates = runs
		.filter((run) => run.rise > 0)
		.map((run) => run.rate)
		.sort((a, b) => a - b);
	if (!rates.length) return undefined;
	const middle = Math.floor(rates.length / 2);
	const median = rates.length % 2 ? rates[middle] : (rates[middle - 1] + rates[middle]) / 2;
	return Math.round(median * 10) / 10;
}

/** minutes to the target at that rate; none when it is there, or the rate is unknown */
export function minutesToTarget(value?: number, target?: number, rate?: number) {
	if (value === undefined || target === undefined || !rate || rate <= 0) return undefined;
	if (value >= target) return undefined;
	return Math.max(5, Math.round((((target - value) / rate) * 60) / 5) * 5);
}

/** hours on in [start, end] */
export function hoursOn(spans: Span[], start: number, end: number) {
	let total = 0;
	for (const span of spans)
		total += Math.max(0, Math.min(end, span.to) - Math.max(start, span.from));
	return Math.round((total / 3_600_000) * 10) / 10;
}

/** a room heating since `since` at `start` °C */
export interface Warming {
	since: number;
	start: number;
}

/**
 * Following a room that heats: it starts when it starts heating, and starts
 * over whenever it stops or gets warmer, so a stall is counted from the
 * last time it warmed.
 */
export function trackWarming(
	before: Warming | undefined,
	heating: boolean,
	value: number | undefined,
	now: number
): Warming | undefined {
	if (!heating || value === undefined) return undefined;
	if (!before || value >= before.start + STALL_RISE) return { since: now, start: value };
	return before;
}

export const stalled = (warming: Warming | undefined, now: number) =>
	!!warming && now - warming.since >= STALL_MINUTES * 60_000;
