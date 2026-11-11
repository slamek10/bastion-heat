/**
 * How much energy the house needs per heating degree-day, per month and
 * per heating season (July–June), from Home Assistant's daily statistics.
 * A cold month needs more energy anyway; per degree-day the seasons can be
 * compared fairly: a lower number is a better house or better settings.
 */
import { degreeDays, seasonOf } from '$lib/comfort';

/** one row of HA's recorder statistics; start is ms (new HA) or an ISO string (old) */
export interface StatRow {
	start: number | string;
	mean?: number | null;
	min?: number | null;
	max?: number | null;
	change?: number | null;
}

export interface Day {
	/** YYYY-MM-DD, local time */
	date: string;
	outdoor?: number;
	hdd: number;
	kwh: number;
	/** a meter reported this day; days without data stay out of the ratio */
	metered?: boolean;
	/** from Vaillant: gas for hot water and the boiler's electricity, kWh (not in kwh) */
	dhw?: number;
	electric?: number;
}

export interface Period {
	key: string;
	days: number;
	hdd: number;
	/** all energy in the period */
	kwh: number;
	/** energy on heating days only (days with degree-days); hot water in summer stays out */
	heatingKwh: number;
	/** kWh per degree-day, from heating days */
	perHdd?: number;
	cost?: number;
}

const startOf = (row: StatRow) =>
	new Date(typeof row.start === 'number' ? row.start : Date.parse(row.start));

export function dateKey(date: Date) {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** a day per outdoor mean, with the energy of every meter summed */
export function dailyRows(outdoor: StatRow[], meters: StatRow[][], base = 18): Day[] {
	const days = new Map<string, Day>();
	for (const row of outdoor) {
		if (typeof row.mean !== 'number') continue;
		const date = dateKey(startOf(row));
		days.set(date, { date, outdoor: round(row.mean), hdd: degreeDays(row.mean, base), kwh: 0 });
	}
	for (const meter of meters) {
		for (const row of meter) {
			if (typeof row.change !== 'number' || row.change < 0) continue;
			const date = dateKey(startOf(row));
			const day = days.get(date) ?? { date, hdd: 0, kwh: 0 };
			day.kwh = round(day.kwh + row.change, 3);
			day.metered = true;
			days.set(date, day);
		}
	}
	return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Vaillant's days in place of meters: heating gas is the energy, hot water apart */
export function withVaillant(
	days: Day[],
	vaillant: Record<string, { heating: number; dhw: number; electric: number }>
): Day[] {
	const byDate = new Map(days.map((day) => [day.date, { ...day }]));
	for (const [date, figures] of Object.entries(vaillant)) {
		const day = byDate.get(date) ?? { date, hdd: 0, kwh: 0 };
		byDate.set(date, {
			...day,
			kwh: round(figures.heating, 3),
			dhw: round(figures.dhw, 3),
			electric: round(figures.electric, 3),
			metered: true
		});
	}
	return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function summarize(days: Day[], keyOf: (day: Day) => string, price = 0): Period[] {
	const periods = new Map<string, Period & { meteredHdd: number }>();
	for (const day of days) {
		const key = keyOf(day);
		const period = periods.get(key) ?? {
			key,
			days: 0,
			hdd: 0,
			kwh: 0,
			heatingKwh: 0,
			meteredHdd: 0
		};
		period.days++;
		period.hdd += day.hdd;
		period.kwh += day.kwh;
		if (day.hdd > 0 && day.metered) {
			period.heatingKwh += day.kwh;
			period.meteredHdd += day.hdd;
		}
		periods.set(key, period);
	}
	return [...periods.values()].map(({ meteredHdd, ...period }) => ({
		...period,
		hdd: round(period.hdd),
		kwh: round(period.kwh),
		heatingKwh: round(period.heatingKwh),
		perHdd:
			meteredHdd >= 5 && period.heatingKwh > 0
				? round(period.heatingKwh / meteredHdd, 2)
				: undefined,
		...(price > 0 && { cost: round(period.kwh * price, 2) })
	}));
}

export const byMonth = (day: Day) => day.date.slice(0, 7);
export const bySeason = (day: Day) => seasonOf(new Date(`${day.date}T12:00:00`));

/** this season so far against the last season up to the same day, both per degree-day */
export function seasonToDate(days: Day[], today: Date) {
	const season = seasonOf(today);
	const lastYear = new Date(today);
	lastYear.setFullYear(today.getFullYear() - 1);
	const lastSeason = seasonOf(lastYear);
	const until = dateKey(lastYear);
	const [now] = summarize(
		days.filter((day) => bySeason(day) === season),
		() => season
	);
	const [before] = summarize(
		days.filter((day) => bySeason(day) === lastSeason && day.date <= until),
		() => lastSeason
	);
	const change =
		now?.perHdd !== undefined && before?.perHdd
			? Math.round(((now.perHdd - before.perHdd) / before.perHdd) * 100)
			: undefined;
	return { now, before, change };
}

export type Span = 'day' | 'week' | 'month' | 'year';

export interface Bucket {
	/** the first day, YYYY-MM-DD */
	key: string;
	kwh: number;
	/** hot water gas, when the source gives it */
	dhw?: number;
	electric?: number;
	/** days in the bucket a meter reported */
	metered: number;
	days: number;
	cost?: number;
}

function bucketStart(date: string, span: Span) {
	if (span === 'day') return date;
	if (span === 'month') return `${date.slice(0, 7)}-01`;
	if (span === 'year') return `${date.slice(0, 4)}-01-01`;
	const day = new Date(`${date}T12:00:00`);
	day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
	return dateKey(day);
}

const LIMITS: Record<Span, number> = { day: 31, week: 26, month: 24, year: 10 };

/** energy per day, week (from Monday), month or year; the most recent ones, oldest first */
export function consumption(days: Day[], span: Span, price = 0): Bucket[] {
	const buckets = new Map<string, Bucket>();
	for (const day of days) {
		const key = bucketStart(day.date, span);
		const bucket = buckets.get(key) ?? { key, kwh: 0, metered: 0, days: 0 };
		bucket.days++;
		if (day.metered) {
			bucket.metered++;
			bucket.kwh += day.kwh;
			if (day.dhw !== undefined) bucket.dhw = (bucket.dhw ?? 0) + day.dhw;
			if (day.electric !== undefined) bucket.electric = (bucket.electric ?? 0) + day.electric;
		}
		buckets.set(key, bucket);
	}
	return [...buckets.values()]
		.sort((a, b) => a.key.localeCompare(b.key))
		.slice(-LIMITS[span])
		.map((bucket) => ({
			...bucket,
			kwh: round(bucket.kwh),
			...(bucket.dhw !== undefined && { dhw: round(bucket.dhw) }),
			...(bucket.electric !== undefined && { electric: round(bucket.electric) }),
			...(price > 0 &&
				bucket.metered && { cost: round((bucket.kwh + (bucket.dhw ?? 0)) * price, 2) })
		}));
}
