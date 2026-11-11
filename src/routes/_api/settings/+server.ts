import { json } from '@sveltejs/kit';
import { loadSettings, saveSettings } from '$lib/server/store';
import { refreshWatched } from '$lib/server/heat';
import {
	DEFAULT_SETTINGS,
	type Aggregation,
	type Preset,
	type Room,
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

export const GET = async () => json(await loadSettings());

export async function PUT({ request }) {
	const body = (await request.json().catch(() => ({}))) as Partial<Settings>;
	const before = await loadSettings();
	const e = (body.entities ?? before.entities) as unknown as Record<string, unknown>;
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
		rooms: Array.isArray(body.rooms)
			? body.rooms
					.map(cleanRoom)
					.filter((room): room is Room => !!room)
					.slice(0, 40)
			: before.rooms,
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
			: before.frostSensors
	};
	await saveSettings(settings);
	await refreshWatched();
	return json(settings);
}
