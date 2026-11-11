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
		...(entity(input?.humidity) && { humidity: entity(input.humidity) })
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
				['ac', 'flow', 'outdoor', 'pressure', 'curve', 'dhw', 'waterHeater', 'indoor']
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
		)
	};
	await saveSettings(settings);
	await refreshWatched();
	return json(settings);
}
