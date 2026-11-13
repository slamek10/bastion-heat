import { json } from '@sveltejs/kit';
import { loadSettings, saveSettings } from '$lib/server/store';
import { refreshWatched } from '$lib/server/heat';
import { settingsChanged } from '$lib/server/brain';
import { cleanSchedule } from '$lib/server/schedule';
import { ITEM } from '$lib/overview';
import {
	DEFAULT_SETTINGS,
	type Aggregation,
	type OverviewBlock,
	type Preset,
	type BrainSettings,
	type Room,
	type RoomSchedule,
	type Settings
} from '$lib/types';

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
const entity = (value: unknown) =>
	typeof value === 'string' && ENTITY.test(value) ? value : undefined;
const entities = (value: unknown, max = 20) =>
	Array.isArray(value)
		? value
				.map(entity)
				.filter((id): id is string => !!id)
				.slice(0, max)
		: [];
const text = (value: unknown, max: number) =>
	typeof value === 'string' ? value.trim().slice(0, max) : '';
const AGGREGATIONS: Aggregation[] = ['mean', 'median', 'min'];
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const range = (value: unknown, min: number, max: number, fallback: number) => {
	const number = Number(value);
	return Number.isFinite(number) && value !== '' && value !== null
		? Math.min(max, Math.max(min, number))
		: fallback;
};

/** names only for the room's own entities, at most 60 characters */
function labelsOf(input: any) {
	if (!input?.labels || typeof input.labels !== 'object') return {};
	const own = new Set(
		[...entities(input.sensors), ...entities(input.trvs), entity(input.humidity)].filter(Boolean)
	);
	const labels = Object.fromEntries(
		Object.entries(input.labels)
			.filter(([id, name]) => own.has(id) && typeof name === 'string' && name.trim())
			.map(([id, name]) => [id, (name as string).trim().slice(0, 60)])
	);
	return Object.keys(labels).length ? { labels } : {};
}

function cleanRoom(input: any, index: number): Room | undefined {
	const name = text(input?.name, 60);
	if (!name) return undefined;
	return {
		id: text(input?.id, 40).replace(/[^\w-]/g, '') || `room-${index}`,
		name,
		...(text(input?.icon, 60) && { icon: text(input.icon, 60) }),
		sensors: entities(input?.sensors),
		aggregation: AGGREGATIONS.includes(input?.aggregation) ? input.aggregation : 'mean',
		trvs: entities(input?.trvs),
		...(entity(input?.ac) && { ac: entity(input.ac) }),
		windows: entities(input?.windows),
		...(entity(input?.humidity) && { humidity: entity(input.humidity) }),
		...(entity(input?.co2) && { co2: entity(input.co2) }),
		...labelsOf(input)
	};
}

function cleanPreset(input: any, index: number): Preset | undefined {
	const name = text(input?.name, 40);
	if (!name) return undefined;
	return {
		id: text(input?.id, 40).replace(/[^\w-]/g, '') || `preset-${index}`,
		name,
		...(text(input?.icon, 60) && { icon: text(input.icon, 60) }),
		targets: (Array.isArray(input?.targets) ? input.targets : [])
			.map((target: any) => ({
				entity_id: entity(target?.entity_id),
				...(Number.isFinite(Number(target?.temperature)) &&
					target?.temperature !== '' && { temperature: Number(target.temperature) }),
				...(text(target?.hvac_mode, 20) && { hvac_mode: text(target.hvac_mode, 20) })
			}))
			.filter((target: any) => target.entity_id)
			.slice(0, 20)
	};
}

function cleanSchedules(input: unknown, rooms: Room[], before: Settings['schedules']) {
	if (!input || typeof input !== 'object') return before;
	const ids = new Set(rooms.map((room) => room.id));
	return Object.fromEntries(
		Object.entries(input as Record<string, unknown>)
			.filter(([id]) => ids.has(id))
			.map(([id, value]) => [id, cleanSchedule(value)])
			.filter(([, value]) => value)
	) as Settings['schedules'];
}

/** Pregled's layout: panels with a short name and known cards, cards on their own */
function cleanOverview(input: unknown, before: OverviewBlock[]): OverviewBlock[] {
	if (!Array.isArray(input)) return before ?? [];
	const items = (value: unknown) =>
		Array.isArray(value)
			? value.filter((id): id is string => typeof id === 'string' && ITEM.test(id)).slice(0, 80)
			: [];
	return input
		.map((block: any): OverviewBlock | undefined => {
			if (typeof block?.group === 'string') {
				const group = block.group.replace(/[^\w-]/g, '').slice(0, 40);
				if (!group) return undefined;
				const title = text(block.title, 40);
				return { group, ...(title && { title }), items: items(block.items) };
			}
			return typeof block?.item === 'string' && ITEM.test(block.item)
				? { item: block.item }
				: undefined;
		})
		.filter((block): block is OverviewBlock => !!block)
		.slice(0, 60);
}

function cleanBrain(input: any, before: BrainSettings): BrainSettings {
	const b = input && typeof input === 'object' ? input : {};
	return {
		enabled: flag(b.enabled, before.enabled),
		dryRun: flag(b.dryRun, before.dryRun),
		hysteresis: range(b.hysteresis, 0.1, 2, before.hysteresis),
		minMinutes: Math.round(range(b.minMinutes, 5, 120, before.minMinutes)),
		closedTemp: range(b.closedTemp, 4, 16, before.closedTemp),
		openOffset: range(b.openOffset, 0, 6, before.openOffset),
		ecoTemp: range(b.ecoTemp, 5, 22, before.ecoTemp),
		house: flag(b.house, before.house),
		windows: flag(b.windows, before.windows),
		frostTemp: range(b.frostTemp, 4, 12, before.frostTemp)
	};
}

export const GET = async () => json(await loadSettings());

export async function PUT({ request }) {
	const body = (await request.json().catch(() => ({}))) as Partial<Settings>;
	const before = await loadSettings();
	const e = (body.entities ?? before.entities) as unknown as Record<string, unknown>;
	const rooms = Array.isArray(body.rooms)
		? body.rooms
				.map(cleanRoom)
				.filter((room): room is Room => !!room)
				.slice(0, 40)
		: before.rooms;
	const settings: Settings = {
		locale: body.locale === 'en' ? 'en' : 'hr',
		theme:
			typeof body.theme === 'string' && /^[\w-]+$/.test(body.theme)
				? body.theme
				: DEFAULT_SETTINGS.theme,
		notifyServices: Array.isArray(body.notifyServices)
			? body.notifyServices.filter((name) => typeof name === 'string' && /^[\w.]+$/.test(name))
			: [],
		systemAlerts: body.systemAlerts !== false,
		entities: {
			zone: entity(e.zone) ?? DEFAULT_SETTINGS.entities.zone,
			...Object.fromEntries(
				[
					'ac',
					'flow',
					'outdoor',
					'pressure',
					'curve',
					'dhw',
					'waterHeater',
					'indoor',
					'outdoorHumidity'
				]
					.map((key) => [key, entity(e[key])])
					.filter(([, value]) => value)
			)
		},
		rooms,
		presets: Array.isArray(body.presets)
			? body.presets
					.map(cleanPreset)
					.filter((preset): preset is Preset => !!preset)
					.slice(0, 12)
			: before.presets,
		staleMinutes: Math.min(
			720,
			Math.max(10, Math.round(Number(body.staleMinutes)) || before.staleMinutes)
		),
		airingAlerts: flag(body.airingAlerts, before.airingAlerts),
		humidityLimit: range(body.humidityLimit, 30, 95, before.humidityLimit),
		co2Limit: range(body.co2Limit, 500, 5000, before.co2Limit),
		frostAlerts: flag(body.frostAlerts, before.frostAlerts),
		frostLimit: range(body.frostLimit, -10, 20, before.frostLimit),
		frostSensors: Array.isArray(body.frostSensors)
			? entities(body.frostSensors, 30)
			: before.frostSensors,
		healthAlerts: flag(body.healthAlerts, before.healthAlerts),
		batteryLimit: Math.round(range(body.batteryLimit, 5, 50, before.batteryLimit)),
		energySource:
			body.energySource === 'vaillant' || body.energySource === 'meters'
				? body.energySource
				: before.energySource,
		heatingEnergy: Array.isArray(body.heatingEnergy)
			? entities(body.heatingEnergy, 10)
			: before.heatingEnergy,
		energyPrice: range(body.energyPrice, 0, 5, before.energyPrice),
		hddBase: range(body.hddBase, 12, 24, before.hddBase),
		report: {
			enabled: flag(body.report?.enabled, before.report.enabled),
			weekday: Math.round(range(body.report?.weekday, 1, 7, before.report.weekday)),
			hour: Math.round(range(body.report?.hour, 0, 23, before.report.hour))
		},
		brain: cleanBrain(body.brain, before.brain),
		aiEffort: ['low', 'medium', 'high'].includes(body.aiEffort as string)
			? (body.aiEffort as Settings['aiEffort'])
			: before.aiEffort,
		schedules: cleanSchedules(body.schedules, rooms, before.schedules),
		overview: cleanOverview(body.overview, before.overview)
	};
	await saveSettings(settings);
	await refreshWatched();
	if (
		JSON.stringify([settings.brain, settings.schedules]) !==
		JSON.stringify([before.brain, before.schedules])
	)
		await settingsChanged();
	return json(settings);
}
