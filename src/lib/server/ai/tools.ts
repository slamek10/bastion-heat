/**
 * What the assistant can do in Heat. Reading tools run freely: the rooms as
 * they are, the system, history, the brain's decisions, the equipment's
 * health and the energy figures. A change is only ever a proposal
 * (propose_schedule, propose_target) that waits for the user's Potvrdi;
 * nothing here sends a command to Home Assistant.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { loadSettings } from '$lib/server/store';
import { getState, history } from '$lib/server/ha';
import { currentRooms } from '$lib/server/heat';
import { currentPlans, decisions } from '$lib/server/brain';
import { currentAlerts } from '$lib/server/checks';
import { diagnostics, heatingEdges, roomStats, temperaturePoints } from '$lib/server/health';
import { efficiency } from '$lib/server/efficiency';
import { listReports } from '$lib/server/report';
import { cleanSchedule } from '$lib/server/schedule';
import { describeSchedule, propose } from '$lib/server/ai/proposals';
import { combine, hoursOn, spansOf, union } from '$lib/health';
import { dewPoint } from '$lib/comfort';
import { targetFlow } from '$lib/curve';
import { numberOf, zoneFor } from '$lib/rooms';
import { translate, type Key } from '$lib/i18n';
import type { Proposal, Room, Settings } from '$lib/types';

const MAX_RESULT = 40_000;

type Schema = Anthropic.Beta.BetaTool['input_schema'];

const tool = (
	name: string,
	description: string,
	input_schema: Schema
): Anthropic.Beta.BetaTool => ({ name, description, input_schema, eager_input_streaming: true });

const BLOCK = {
	type: 'object',
	properties: {
		days: {
			type: 'array',
			items: { type: 'integer', minimum: 1, maximum: 7 },
			description: '1 = Monday … 7 = Sunday'
		},
		from: { type: 'string', description: 'HH:MM' },
		to: { type: 'string', description: 'HH:MM, after from; 24:00 for midnight' },
		temp: { type: 'number', minimum: 5, maximum: 30 }
	},
	required: ['days', 'from', 'to', 'temp']
};

export const TOOLS: Anthropic.Beta.BetaTool[] = [
	tool(
		'rooms',
		"Every room as it is now: its temperature combined from its sensors (each sensor with its value and whether it is stale), what its valves' own thermostats measure, the target, heating or not, waiting (valves open but the boiler idle), window open, humidity and dew point, the brain's plan (target, why, until when), its weekly schedule, and from the last 7 days its heat-up rate in °C/h while heating and hours heated per day. Start here; it gives the room ids.",
		{ type: 'object', properties: {} }
	),
	tool(
		'system',
		"The boiler side: the heating zone (mode, action, setpoint, the temperature its thermostat measures), flow temperature and the flow the heating curve asks for now, outdoor temperature, water pressure, the curve slope (read only: it is set in the myVAILLANT app), hot water, the air conditioner, and the brain's settings (on, trial mode, hysteresis, minimum minutes between commands, eco and frost temperatures).",
		{ type: 'object', properties: {} }
	),
	tool(
		'history',
		"Hour by hour over the last hours (up to 240): each room's mean temperature and minutes it heated, the outdoor temperature, and the zone's setpoint. Leave room_id out for all rooms.",
		{
			type: 'object',
			properties: {
				room_id: { type: 'string' },
				hours: { type: 'integer', minimum: 1, maximum: 240 }
			},
			required: ['hours']
		}
	),
	tool(
		'decisions',
		"The brain's last decisions, newest first: what it set (or in the trial mode would have set) on which valve or the zone, and why.",
		{
			type: 'object',
			properties: {
				room_id: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 100 }
			}
		}
	),
	tool(
		'health',
		"The equipment: each valve's battery, when it last reported, offline or not taking its setpoint; the Imou API calls this month and the projection; and the warnings shown now (cold, airing, valves, battery, pressure, boiler, a room not warming).",
		{ type: 'object', properties: {} }
	),
	tool(
		'energy',
		'Heating energy: per heating season and per month (kWh, degree days, kWh per degree day, cost when a price is set), the season so far against the last one, the last 30 days, and the latest weekly report (rooms against their targets, tips).',
		{ type: 'object', properties: {} }
	),
	tool(
		'propose_schedule',
		'Propose a new weekly schedule for one room: the whole schedule (blocks of days and times at a temperature, and the base temperature between them), not a diff. The brain heats by it once the user presses Potvrdi on the card in the chat; until then nothing changes. A later block wins where two overlap. Overnight needs two blocks (to 24:00, from 00:00).',
		{
			type: 'object',
			properties: {
				room_id: { type: 'string' },
				enabled: { type: 'boolean' },
				base: { type: 'number', minimum: 5, maximum: 30 },
				blocks: { type: 'array', items: BLOCK, maxItems: 30 },
				reason: { type: 'string', description: 'one sentence: why, shown to the user' }
			},
			required: ['room_id', 'enabled', 'base', 'blocks', 'reason']
		}
	),
	tool(
		'propose_target',
		"Propose a temperature for one room now. In a room the brain runs by a schedule it holds until the schedule next changes; otherwise it is set on the room's valves (or the zone when its thermostat is in the room). Applies only once the user presses Potvrdi.",
		{
			type: 'object',
			properties: {
				room_id: { type: 'string' },
				temperature: { type: 'number', minimum: 5, maximum: 30 },
				reason: { type: 'string', description: 'one sentence: why, shown to the user' }
			},
			required: ['room_id', 'temperature', 'reason']
		}
	)
];

export class ToolInputError extends Error {}

type Spec = {
	type: string;
	enum?: string[];
	minimum?: number;
	maximum?: number;
	items?: Spec & { properties?: Record<string, Spec>; required?: string[] };
	properties?: Record<string, Spec>;
	required?: string[];
	maxItems?: number;
};

/** checks a value against the schema; eager input streaming leaves this to us */
function check(path: string, value: unknown, spec: Spec) {
	if (spec.type === 'string' && typeof value !== 'string')
		throw new ToolInputError(`${path} must be a string`);
	if (spec.type === 'boolean' && typeof value !== 'boolean')
		throw new ToolInputError(`${path} must be true or false`);
	if (spec.type === 'integer' && !Number.isInteger(value))
		throw new ToolInputError(`${path} must be an integer`);
	if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
		throw new ToolInputError(`${path} must be a number`);
	if ((spec.type === 'integer' || spec.type === 'number') && typeof value === 'number') {
		if (spec.minimum !== undefined && value < spec.minimum)
			throw new ToolInputError(`${path} is below ${spec.minimum}`);
		if (spec.maximum !== undefined && value > spec.maximum)
			throw new ToolInputError(`${path} is above ${spec.maximum}`);
	}
	if (spec.enum && !spec.enum.includes(value as string))
		throw new ToolInputError(`${path} must be one of ${spec.enum.join(', ')}`);
	if (spec.type === 'array') {
		if (!Array.isArray(value)) throw new ToolInputError(`${path} must be a list`);
		if (spec.maxItems !== undefined && value.length > spec.maxItems)
			throw new ToolInputError(`${path} has more than ${spec.maxItems}`);
		if (spec.items) value.forEach((item, index) => check(`${path}[${index}]`, item, spec.items!));
	}
	if (spec.type === 'object') {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new ToolInputError(`${path} must be an object`);
		const object = value as Record<string, unknown>;
		for (const key of spec.required ?? [])
			if (object[key] === undefined || object[key] === '')
				throw new ToolInputError(`${path ? `${path}.` : ''}${key} is required`);
		for (const [key, item] of Object.entries(object)) {
			const inner = spec.properties?.[key];
			if (!inner) throw new ToolInputError(`unknown field ${path ? `${path}.` : ''}${key}`);
			check(path ? `${path}.${key}` : key, item, inner);
		}
	}
}

export function validate(name: string, input: unknown): Record<string, unknown> {
	const schema = TOOLS.find((entry) => entry.name === name)?.input_schema;
	if (!schema) throw new ToolInputError(`unknown tool ${name}`);
	check('', input ?? {}, schema as unknown as Spec);
	return (input ?? {}) as Record<string, unknown>;
}

const text = (value: unknown) => {
	const raw = typeof value === 'string' ? value : JSON.stringify(value);
	return raw.length > MAX_RESULT
		? `${raw.slice(0, MAX_RESULT)}\n…(cut, ${raw.length} characters in all)`
		: raw;
};

const round = (value: number | undefined, digits = 1) =>
	value === undefined ? undefined : Math.round(value * 10 ** digits) / 10 ** digits;

function roomOf(settings: Settings, id: unknown): Room {
	const room = settings.rooms.find((entry) => entry.id === id);
	if (!room) throw new ToolInputError('unknown room_id; call rooms');
	return room;
}

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : undefined);

async function roomsNow(settings: Settings) {
	const plans = new Map(currentPlans().map((plan) => [plan.roomId, plan]));
	const stats = new Map(
		(await roomStats(settings).catch(() => [])).map((entry) => [entry.roomId, entry])
	);
	return (await currentRooms()).map(({ room, reading }) => {
		const plan = plans.get(room.id);
		const schedule = settings.schedules[room.id];
		const week = stats.get(room.id);
		return {
			id: room.id,
			name: room.name,
			temperature: reading.value,
			combined: room.aggregation,
			sensors: reading.used.map((sensor) => ({
				name: room.labels?.[sensor.entity] ?? sensor.entity,
				value: sensor.value,
				stale: sensor.stale
			})),
			valves_measure: reading.thermostat,
			target: reading.target,
			heating: reading.heating,
			waiting_for_boiler: reading.waiting,
			window_open: reading.windowOpen,
			humidity: reading.humidity,
			dew_point:
				reading.value !== undefined && reading.humidity !== undefined
					? dewPoint(reading.value, reading.humidity)
					: undefined,
			valves: room.trvs.length,
			heated_by: room.trvs.length
				? 'valves'
				: zoneFor(room, settings.entities)
					? 'main zone thermostat'
					: room.ac
						? 'air conditioner'
						: 'nothing controlled, temperature only',
			plan: plan?.managed
				? {
						target: plan.target,
						source: plan.source,
						until: iso(plan.until),
						asks_for_heat: plan.calling,
						why: translate('en', plan.reason as Key, plan.vars)
					}
				: 'not run by the brain',
			schedule: schedule
				? { ...schedule, readable: describeSchedule(schedule, 'en') }
				: 'no schedule',
			last_7_days: week && {
				heat_up_rate_c_per_h: week.rate,
				heating_stretches_measured: week.runs,
				hours_heated_per_day: week.hoursDay,
				hours_heated_last_24h: week.hours24
			}
		};
	});
}

function systemNow(settings: Settings) {
	const e = settings.entities;
	const state = (id?: string) => (id ? getState(id) : undefined);
	const zone = state(e.zone);
	const outdoor = numberOf(state(e.outdoor));
	const slope = numberOf(state(e.curve));
	const setpoint = numberOf(zone, 'temperature');
	const ac = state(e.ac);
	return {
		now: new Date().toISOString(),
		timezone: process.env.TZ || 'Europe/Zagreb',
		zone: zone && {
			mode: zone.state,
			action: zone.attributes?.hvac_action,
			setpoint,
			measures: numberOf(zone, 'current_temperature') ?? numberOf(state(e.indoor)),
			preset: zone.attributes?.preset_mode
		},
		flow_temperature: numberOf(state(e.flow)),
		flow_the_curve_asks:
			outdoor !== undefined && setpoint !== undefined && slope !== undefined
				? targetFlow(outdoor, setpoint, slope)
				: undefined,
		outdoor,
		water_pressure_bar: numberOf(state(e.pressure)),
		curve_slope: slope,
		hot_water: state(e.dhw)?.state ?? state(e.waterHeater)?.state,
		air_conditioner: ac && {
			mode: ac.state,
			setpoint: numberOf(ac, 'temperature'),
			measures: numberOf(ac, 'current_temperature')
		},
		brain: settings.brain,
		stale_after_minutes: settings.staleMinutes
	};
}

type Row = { s: string; a?: Record<string, any>; lu?: number; lc?: number };

/** an attribute's value over time, from history rows that carry attributes only when they change */
function attributePoints(rows: Row[], key: string) {
	let attributes: Record<string, any> = {};
	const out: { t: number; v: number }[] = [];
	for (const row of rows) {
		if (row.a) attributes = row.a;
		const seconds = row.lu ?? row.lc;
		const v = Number(attributes[key]);
		if (typeof seconds === 'number' && Number.isFinite(v)) out.push({ t: seconds * 1000, v });
	}
	return out;
}

async function hourly(settings: Settings, hours: number, roomId?: string) {
	const rooms = roomId ? [roomOf(settings, roomId)] : settings.rooms;
	const end = Date.now();
	const start = end - hours * 3_600_000;
	const climates = new Set<string>([settings.entities.zone]);
	const sensors = new Set<string>();
	if (settings.entities.outdoor) sensors.add(settings.entities.outdoor);
	for (const room of rooms) {
		for (const id of room.trvs) climates.add(id);
		if (room.ac) climates.add(room.ac);
		for (const id of room.sensors) (id.startsWith('climate.') ? climates : sensors).add(id);
	}
	const [a, b] = await Promise.all([
		history([...climates], new Date(start), new Date(end)),
		sensors.size ? history([...sensors], new Date(start), new Date(end)) : Promise.resolve({})
	]);
	const rows: Record<string, Row[]> = { ...b, ...a };
	const meanPerHour = (points: { t: number; v: number }[], from: number) => {
		const inHour = points.filter((p) => p.t >= from && p.t < from + 3_600_000);
		return inHour.length ? round(inHour.reduce((s, p) => s + p.v, 0) / inHour.length) : undefined;
	};
	const hoursList = Array.from({ length: hours }, (_, index) => start + index * 3_600_000);
	const outdoorLine = settings.entities.outdoor
		? combine(
				[temperaturePoints(settings.entities.outdoor, rows[settings.entities.outdoor] ?? [])],
				start,
				end,
				10 * 60_000
			)
		: [];
	const zoneSetpoint = combine(
		[attributePoints(rows[settings.entities.zone] ?? [], 'temperature')],
		start,
		end,
		10 * 60_000
	);
	return {
		hours: hoursList.map((from) => ({
			hour: new Date(from).toISOString().slice(0, 13) + ':00Z',
			outdoor: meanPerHour(outdoorLine, from),
			zone_setpoint: meanPerHour(zoneSetpoint, from)
		})),
		rooms: rooms.map((room) => {
			const line = combine(
				room.sensors.map((id) => temperaturePoints(id, rows[id] ?? [])),
				start,
				end,
				10 * 60_000
			);
			const heaters = room.trvs.length
				? room.trvs
				: ([zoneFor(room, settings.entities) ?? room.ac].filter(Boolean) as string[]);
			const spans = union(
				heaters.map((id) => spansOf(heatingEdges(rows[id] ?? [], room.trvs.length > 0).edges, end))
			);
			return {
				id: room.id,
				name: room.name,
				hourly: hoursList.map((from) => ({
					t: meanPerHour(line, from),
					heated_min: Math.round(hoursOn(spans, from, from + 3_600_000) * 60)
				}))
			};
		})
	};
}

async function energyNow() {
	const data = await efficiency();
	const reports = await listReports();
	return {
		source: data.source,
		price_per_kwh: data.price || undefined,
		degree_day_base: data.hddBase,
		seasons: data.seasons,
		months: data.months,
		season_to_date: data.toDate,
		last_30_days: data.days.slice(-30),
		latest_weekly_report: reports.at(-1)
	};
}

/** what the chat shows while a tool runs */
export function summarize(name: string, input: Record<string, unknown>) {
	const parts = [
		input.room_id,
		input.hours && `${input.hours} h`,
		input.temperature && `${input.temperature}°`
	]
		.filter(Boolean)
		.map(String);
	return parts.join(' · ').slice(0, 120);
}

export interface ToolEffects {
	proposal?: Proposal;
}

export async function runTool(
	name: string,
	rawInput: unknown,
	conversationId: string
): Promise<{ content: string; isError?: boolean; effects?: ToolEffects }> {
	let input: Record<string, unknown>;
	try {
		input = validate(name, rawInput);
	} catch (error) {
		return { content: `INVALID_INPUT: ${(error as Error).message}`, isError: true };
	}
	const settings = await loadSettings();
	try {
		switch (name) {
			case 'rooms':
				return { content: text(await roomsNow(settings)) };
			case 'system':
				return { content: text(systemNow(settings)) };
			case 'history':
				return {
					content: text(
						await hourly(settings, Number(input.hours), input.room_id as string | undefined)
					)
				};
			case 'decisions': {
				const limit = Number(input.limit ?? 30);
				const list = (await decisions())
					.filter((entry) => !input.room_id || entry.roomId === input.room_id)
					.slice(-limit)
					.reverse()
					.map((entry) => ({
						at: iso(entry.at),
						entity: entry.entity,
						room: entry.roomId,
						set: entry.temperature,
						trial_only: entry.dry,
						why: translate('en', entry.reason as Key, entry.vars),
						...(entry.error && { error: entry.error })
					}));
				return { content: text(list.length ? list : 'No decisions yet.') };
			}
			case 'health': {
				const data = await diagnostics();
				return {
					content: text({
						valves: data.valves.map((valve) => ({
							...valve,
							room: settings.rooms.find((room) => room.id === valve.roomId)?.name,
							lastSeen: iso(valve.lastSeen)
						})),
						imou_api: data.quota ?? 'no Imou counters found',
						warnings_now: currentAlerts().map((alert) => ({
							kind: alert.kind,
							about: alert.name,
							text: translate('en', alert.message as Key, alert.vars),
							since: iso(alert.since)
						}))
					})
				};
			}
			case 'energy':
				return { content: text(await energyNow()) };
			case 'propose_schedule': {
				const room = roomOf(settings, input.room_id);
				const schedule = cleanSchedule({
					enabled: input.enabled,
					base: input.base,
					blocks: input.blocks
				});
				const asked = (input.blocks as unknown[]).length;
				if (!schedule || schedule.blocks.length !== asked)
					throw new ToolInputError(
						'some blocks were not valid: each needs days 1-7, from before to (HH:MM), a temperature 5-30; overnight is two blocks'
					);
				const proposal = await propose({
					kind: 'schedule',
					roomId: room.id,
					roomName: room.name,
					label: describeSchedule(schedule, settings.locale),
					reason: String(input.reason).slice(0, 300),
					schedule,
					...(settings.schedules[room.id] && { before: settings.schedules[room.id] }),
					conversationId
				});
				return waiting(proposal, settings);
			}
			case 'propose_target': {
				const room = roomOf(settings, input.room_id);
				const temperature = Math.round(Number(input.temperature) * 2) / 2;
				const proposal = await propose({
					kind: 'target',
					roomId: room.id,
					roomName: room.name,
					label: `${room.name}: ${temperature.toFixed(1)}°`,
					reason: String(input.reason).slice(0, 300),
					temperature,
					conversationId
				});
				return waiting(proposal, settings);
			}
		}
		return { content: `unknown tool ${name}`, isError: true };
	} catch (error) {
		return {
			content: `${error instanceof ToolInputError ? 'INVALID_INPUT' : 'ERROR'}: ${(error as Error).message.slice(0, 500)}`,
			isError: true
		};
	}
}

function waiting(proposal: Proposal, settings: Settings) {
	return {
		content: text({
			status: 'waiting_for_user',
			note: 'A card with Potvrdi / Odbij is shown to the user; it expires in 30 minutes. Nothing has changed yet.',
			change: proposal.label,
			brain: settings.brain.enabled
				? settings.brain.dryRun
					? 'on, in the trial mode: a schedule is only logged, no command goes to the valves'
					: 'on'
				: 'off: a schedule is saved but nothing heats by it until the brain is turned on'
		}),
		effects: { proposal }
	};
}
