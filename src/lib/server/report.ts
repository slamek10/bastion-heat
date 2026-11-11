/**
 * The weekly report: per room the average, lowest and highest temperature
 * (HA's hourly statistics), the average target and hours of heating (the
 * thermostat's history), alerts; for the house energy, cost, degree-days
 * and kWh per degree-day against the week before; and tips. Made on the
 * set day and hour, or on demand; the last 26 are kept.
 */
import { loadSettings, read, write } from '$lib/server/store';
import { history, statistics } from '$lib/server/ha';
import { days } from '$lib/server/efficiency';
import { alertLog } from '$lib/server/checks';
import { sendNotification } from '$lib/server/notify';
import { dateKey } from '$lib/efficiency';
import { heatingHours, meanTarget, roomWeek, tips, type RoomWeek, type Tip } from '$lib/report';
import { translate, type Key } from '$lib/i18n';

export interface Report {
	id: string;
	createdAt: number;
	start: number;
	end: number;
	rooms: RoomWeek[];
	energy: {
		kwh?: number;
		cost?: number;
		hdd: number;
		perHdd?: number;
		previousPerHdd?: number;
		change?: number;
	};
	tips: Tip[];
}

const DAY = 86_400_000;
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export const listReports = () => read<Report[]>('reports.json', []);

export async function makeReport(end = new Date()): Promise<Report> {
	const settings = await loadSettings();
	const startDate = new Date(end.getTime() - 7 * DAY);
	const start = startDate.getTime();

	const sensorIds = [...new Set(settings.rooms.flatMap((room) => room.sensors))];
	const climateOf = (room: (typeof settings.rooms)[number]) =>
		room.trvs.length ? room.trvs : [settings.entities.zone];
	const climateIds = [...new Set(settings.rooms.flatMap(climateOf))].filter(Boolean);
	const [hourly, climates, allDays, log] = await Promise.all([
		sensorIds.length
			? statistics(sensorIds, startDate, 'hour', ['mean', 'min', 'max'], end)
			: Promise.resolve({} as Awaited<ReturnType<typeof statistics>>),
		climateIds.length
			? history(climateIds, startDate, end)
			: Promise.resolve({} as Awaited<ReturnType<typeof history>>),
		days(),
		alertLog()
	]);

	const rooms: RoomWeek[] = settings.rooms.map((room) => {
		const week = roomWeek(
			room.sensors.map((id) => hourly[id] ?? []),
			room.aggregation
		);
		const thermostats = climateOf(room).map((id) => climates[id] ?? []);
		const hours = thermostats.map((rows) => heatingHours(rows, start, end.getTime()));
		const targets = thermostats
			.map((rows) => meanTarget(rows, start, end.getTime()))
			.filter((v): v is number => v !== undefined);
		const logged = log.filter(
			(entry) => entry.at >= start && entry.at < end.getTime() && entry.key.endsWith(`|${room.id}`)
		);
		return {
			id: room.id,
			name: room.name,
			...week,
			target: targets.length
				? round(targets.reduce((a, b) => a + b, 0) / targets.length)
				: undefined,
			heatingHours: hours.length ? Math.max(...hours) : undefined,
			airing: logged.filter((entry) => entry.kind === 'airing').length,
			cold: logged.filter((entry) => entry.kind === 'cold').length
		};
	});

	const inWeek = (from: number, to: number) =>
		allDays.filter(
			(day) => day.date >= dateKey(new Date(from)) && day.date < dateKey(new Date(to))
		);
	const sum = (list: typeof allDays, pick: (day: (typeof allDays)[number]) => number) =>
		list.reduce((total, day) => total + pick(day), 0);
	const ratio = (list: typeof allDays) => {
		const hdd = sum(list, (day) => day.hdd);
		const kwh = sum(list, (day) => (day.hdd > 0 ? day.kwh : 0));
		return hdd >= 5 && kwh > 0 ? round(kwh / hdd, 2) : undefined;
	};
	const week = inWeek(start, end.getTime());
	const before = inWeek(start - 7 * DAY, start);
	const meters = settings.heatingEnergy.length > 0;
	const kwh = meters ? round(sum(week, (day) => day.kwh)) : undefined;
	const perHdd = meters ? ratio(week) : undefined;
	const previousPerHdd = meters ? ratio(before) : undefined;
	const energy = {
		kwh,
		cost:
			kwh !== undefined && settings.energyPrice > 0
				? round(kwh * settings.energyPrice, 2)
				: undefined,
		hdd: round(sum(week, (day) => day.hdd)),
		perHdd,
		previousPerHdd,
		change:
			perHdd !== undefined && previousPerHdd
				? Math.round(((perHdd - previousPerHdd) / previousPerHdd) * 100)
				: undefined
	};

	return {
		id: `${dateKey(end)}-${end.getTime().toString(36)}`,
		createdAt: Date.now(),
		start,
		end: end.getTime(),
		rooms,
		energy,
		tips: tips(rooms, energy)
	};
}

export async function saveReport(report: Report) {
	const reports = await listReports();
	reports.unshift(report);
	await write('reports.json', reports.slice(0, 26));
}

async function tell(report: Report) {
	const settings = await loadSettings();
	if (!settings.notifyServices.length) return;
	const t = (key: string, vars: Record<string, string> = {}) =>
		translate(settings.locale, key as Key, vars);
	const lines = [
		report.energy.kwh !== undefined
			? t('report_energy_line', {
					kwh: String(report.energy.kwh),
					cost: report.energy.cost !== undefined ? ` (${report.energy.cost.toFixed(2)} €)` : '',
					hdd: String(report.energy.hdd)
				})
			: t('report_hdd_line', { hdd: String(report.energy.hdd) }),
		...report.tips.slice(0, 3).map((tip) => t(tip.key, tip.vars))
	];
	await sendNotification(settings.notifyServices, {
		title: t('report_title'),
		message: lines.join('\n'),
		tag: 'bastion-heat-report'
	}).catch(() => {});
}

/** a report at the set day and hour, once; checked every minute */
async function due() {
	const settings = await loadSettings();
	if (!settings.report.enabled) return;
	const now = new Date();
	const weekday = now.getDay() === 0 ? 7 : now.getDay();
	if (weekday !== settings.report.weekday || now.getHours() !== settings.report.hour) return;
	const [last] = await listReports();
	if (last && Date.now() - last.createdAt < 20 * 3_600_000) return;
	// the week up to midnight of the report day
	const end = new Date(now);
	end.setHours(0, 0, 0, 0);
	const report = await makeReport(end);
	await saveReport(report);
	await tell(report);
}

const global = globalThis as unknown as { __heatReport?: boolean };

export function startReports() {
	if (global.__heatReport || process.env.REPORTS === 'off') return;
	global.__heatReport = true;
	setInterval(
		() => due().catch((error) => console.warn('[report]', (error as Error).message)),
		60_000
	).unref?.();
}
