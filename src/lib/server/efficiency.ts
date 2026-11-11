/**
 * Days of outdoor mean and heating energy from HA's long-term statistics,
 * three seasons back, kept for an hour (statistics change once a day).
 */
import { loadSettings } from '$lib/server/store';
import { statistics } from '$lib/server/ha';
import {
	byMonth,
	bySeason,
	dailyRows,
	seasonToDate,
	summarize,
	withVaillant,
	type Day
} from '$lib/efficiency';
import { loadVaillant } from '$lib/server/vaillant';

const global = globalThis as unknown as { __heatDays?: { at: number; key: string; days: Day[] } };

export async function days(): Promise<Day[]> {
	const settings = await loadSettings();
	const outdoor = settings.entities.outdoor;
	if (!outdoor) return [];
	const vaillant = settings.energySource === 'vaillant' ? await loadVaillant() : undefined;
	const meters = vaillant ? [] : settings.heatingEnergy;
	const key = JSON.stringify([outdoor, meters, settings.hddBase, vaillant?.fetchedAt]);
	const cached = global.__heatDays;
	if (cached && cached.key === key && Date.now() - cached.at < 3_600_000) return cached.days;
	const now = new Date();
	const start = new Date(now.getMonth() >= 6 ? now.getFullYear() - 2 : now.getFullYear() - 3, 6, 1);
	const [temperature, energy] = await Promise.all([
		statistics([outdoor], start, 'day', ['mean']),
		meters.length
			? statistics(meters, start, 'day', ['change'])
			: Promise.resolve({} as Record<string, never[]>)
	]);
	let rows = dailyRows(
		temperature[outdoor] ?? [],
		meters.map((id) => energy[id] ?? []),
		settings.hddBase
	);
	if (vaillant) rows = withVaillant(rows, vaillant.days);
	global.__heatDays = { at: Date.now(), key, days: rows };
	return rows;
}

export async function efficiency() {
	const settings = await loadSettings();
	const all = await days();
	const now = new Date();
	const seasons = summarize(all, bySeason, settings.energyPrice).reverse();
	const twelveMonths = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
	const months = summarize(
		all.filter(
			(day) =>
				day.date >=
				`${twelveMonths.getFullYear()}-${String(twelveMonths.getMonth() + 1).padStart(2, '0')}`
		),
		byMonth,
		settings.energyPrice
	);
	return {
		meters: all.some((day) => day.metered) ? 1 : 0,
		source: settings.energySource,
		hddBase: settings.hddBase,
		seasons,
		months,
		toDate: seasonToDate(all, now),
		price: settings.energyPrice,
		days: all.map(({ date, kwh, metered, dhw, electric }) => ({
			date,
			kwh,
			metered,
			dhw,
			electric
		}))
	};
}
