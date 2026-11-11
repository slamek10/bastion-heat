/**
 * Heat's brain, as pure functions: what each room should be at now (its
 * weekly schedule, or a manual change until the next block), whether it
 * asks for heat (with hysteresis, by the room's own sensors, not the
 * valve's), and the setpoints that follow for its valves and the main zone.
 * The server runs it every minute (server/brain.ts) and decides what is
 * actually sent; nothing here talks to Home Assistant.
 */
import type { Key } from '$lib/i18n';
import type { BrainSettings, HaState, Room, RoomReading, RoomSchedule } from '$lib/types';
import { numberOf } from '$lib/rooms';

export const minutesOf = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + (m || 0);
};

/** 1 = Monday … 7 = Sunday */
export const weekdayOf = (date: Date) => ((date.getDay() + 6) % 7) + 1;

/** the block that holds this moment, else the base temperature */
export function scheduleTarget(schedule: RoomSchedule, date: Date) {
	const day = weekdayOf(date);
	const minute = date.getHours() * 60 + date.getMinutes();
	// a later block wins where two overlap
	for (let index = schedule.blocks.length - 1; index >= 0; index--) {
		const block = schedule.blocks[index];
		if (!block.days.includes(day)) continue;
		if (minute >= minutesOf(block.from) && minute < minutesOf(block.to))
			return { temp: block.temp, block: index };
	}
	return { temp: schedule.base, block: undefined };
}

/** when the schedule's temperature next changes (ms), looking a week ahead */
export function nextChange(schedule: RoomSchedule, now: number) {
	const start = new Date(now);
	const current = scheduleTarget(schedule, start).temp;
	const moments: number[] = [];
	for (let offset = 0; offset <= 7; offset++) {
		for (const block of schedule.blocks) {
			for (const time of [block.from, block.to]) {
				const at = new Date(
					start.getFullYear(),
					start.getMonth(),
					start.getDate() + offset,
					0,
					minutesOf(time)
				).getTime();
				if (at > now) moments.push(at);
			}
		}
	}
	moments.sort((a, b) => a - b);
	return moments.find((at) => scheduleTarget(schedule, new Date(at)).temp !== current);
}

export interface Override {
	temp: number;
	until: number;
}

/** what the brain remembers between rounds (data/brain.json) */
export interface Memory {
	/** rooms asking for heat: hysteresis needs the last answer */
	calling: Record<string, boolean>;
	/** manual changes, until the next schedule block */
	overrides: Record<string, Override>;
	/** the last setpoint sent (or, in the trial mode, that would have been) */
	sent: Record<string, { at: number; temp: number }>;
}

export const emptyMemory = (): Memory => ({ calling: {}, overrides: {}, sent: {} });

export type Source = 'schedule' | 'override';

export interface RoomPlan {
	roomId: string;
	/** the brain looks after this room (it has a schedule that is on) */
	managed: boolean;
	target?: number;
	source?: Source;
	/** the override, or the current schedule block, lasts until */
	until?: number;
	calling: boolean;
	reason: Key;
	vars: Record<string, string>;
}

export interface Wanted {
	entity: string;
	kind: 'trv' | 'zone';
	roomId?: string;
	temperature: number;
	/** turn it to heat first: it is off and has to open */
	hvacMode?: 'heat';
	/** an open window or frost: sent without waiting for the minimum gap */
	urgent: boolean;
	reason: Key;
	vars: Record<string, string>;
}

export interface RoomInput {
	room: Room;
	reading: RoomReading;
	/** the main zone, when this room holds its thermostat */
	zone?: string;
}

const fmt = (value: number) => value.toFixed(1);

/** a setpoint the entity accepts: its step, its limits */
export function fit(value: number, state: HaState | undefined) {
	const attributes = state?.attributes ?? {};
	const step = Number(attributes.target_temp_step) || 0.5;
	let result = Math.round(value / step) * step;
	if (Number.isFinite(Number(attributes.min_temp)))
		result = Math.max(Number(attributes.min_temp), result);
	if (Number.isFinite(Number(attributes.max_temp)))
		result = Math.min(Number(attributes.max_temp), result);
	return Math.round(result * 10) / 10;
}

export function planRoom(
	input: RoomInput,
	schedule: RoomSchedule | undefined,
	brain: BrainSettings,
	memory: Memory,
	now: number
): RoomPlan {
	const { room, reading } = input;
	const base = { roomId: room.id, calling: false, vars: { name: room.name } };
	if (!brain.enabled || !schedule?.enabled) return { ...base, managed: false, reason: 'brain_off' };

	const override = memory.overrides[room.id];
	const active = override && override.until > now ? override : undefined;
	const scheduled = scheduleTarget(schedule, new Date(now));
	// frost protection always holds
	const target = Math.max(active?.temp ?? scheduled.temp, brain.frostTemp);
	const source: Source = active ? 'override' : 'schedule';
	const until = active?.until ?? nextChange(schedule, now);
	const plan = { ...base, managed: true, target, source, until };
	const vars = { ...base.vars, target: fmt(target) };

	if (brain.windows && reading.windowOpen)
		return { ...plan, calling: false, reason: 'brain_window', vars };
	const value = reading.value;
	if (value === undefined) {
		// nothing to go by: keep what it was doing
		return { ...plan, calling: !!memory.calling[room.id], reason: 'brain_no_reading', vars };
	}
	const was = !!memory.calling[room.id];
	const calling = was ? value < target : value <= target - brain.hysteresis;
	return {
		...plan,
		calling,
		reason: calling ? 'brain_wants_heat' : value >= target ? 'brain_warm' : 'brain_near',
		vars: { ...vars, t: fmt(value) }
	};
}

/**
 * The setpoint every device of the managed rooms should have:
 *  - a valve opens to the target plus a margin (its own sensor sits by the
 *    radiator, so it would close early at the room's target) and closes to
 *    its lowest setting when the room is warm or its window is open
 *  - the main zone runs while any room asks for heat; when none do it goes
 *    down to eco. Its setpoint is the target of the room with its
 *    thermostat; while another room needs heat and that room is already
 *    warm, half a degree above that room, so the boiler still runs.
 */
export function wanted(
	inputs: RoomInput[],
	plans: RoomPlan[],
	brain: BrainSettings,
	states: Record<string, HaState>,
	zone: string | undefined
): Wanted[] {
	const out: Wanted[] = [];
	const byId = new Map(plans.map((plan) => [plan.roomId, plan]));
	for (const { room, reading } of inputs) {
		const plan = byId.get(room.id);
		if (!plan?.managed || plan.target === undefined) continue;
		const window = plan.reason === 'brain_window';
		for (const trv of room.trvs) {
			const state = states[trv];
			if (!state) continue;
			const open = plan.calling;
			const temperature = fit(open ? plan.target + brain.openOffset : brain.closedTemp, state);
			out.push({
				entity: trv,
				kind: 'trv',
				roomId: room.id,
				temperature,
				...(open && state.state === 'off' && { hvacMode: 'heat' as const }),
				urgent: window || (reading.value !== undefined && reading.value < brain.frostTemp),
				reason: open ? 'brain_trv_open' : window ? 'brain_trv_window' : 'brain_trv_close',
				vars: { ...plan.vars, sp: String(temperature) }
			});
		}
	}

	if (!brain.house || !zone || !states[zone]) return out;
	const zoneInput = inputs.find((input) => input.zone === zone);
	const zonePlan = zoneInput ? byId.get(zoneInput.room.id) : undefined;
	// the thermostat's own room must be looked after too, else the brain would override it
	if (zoneInput && !zonePlan?.managed) return out;
	const managed = plans.filter((plan) => plan.managed);
	if (!managed.length) return out;
	const needing = managed.filter((plan) => plan.calling && plan.target !== undefined);
	const state = states[zone];
	if (!needing.length) {
		const temperature = fit(brain.ecoTemp, state);
		out.push({
			entity: zone,
			kind: 'zone',
			temperature,
			urgent: false,
			reason: 'brain_zone_eco',
			vars: { sp: String(temperature) }
		});
		return out;
	}
	// the zone's setpoint is its own room's temperature (the other rooms have their valves);
	// with no room of its own, the highest target asked for
	let target = Math.max(...needing.map((plan) => plan.target!));
	if (zonePlan?.target !== undefined) {
		const zoneValue = zoneInput?.reading.value;
		target = zonePlan.calling
			? zonePlan.target
			: Math.max(zonePlan.target, zoneValue !== undefined ? zoneValue + 0.5 : zonePlan.target);
	}
	const temperature = fit(target, state);
	out.push({
		entity: zone,
		kind: 'zone',
		temperature,
		...(state.state === 'off' && { hvacMode: 'heat' as const }),
		urgent: false,
		reason: 'brain_zone_demand',
		vars: { sp: String(temperature), rooms: needing.map((plan) => plan.vars.name).join(', ') }
	});
	return out;
}

/**
 * Of what is wanted, what goes out now: only a real change (the valves'
 * API calls are counted), and to one device at most every minMinutes
 * unless it is urgent. In the trial mode the device never changes, so the
 * last "would have sent" stands in for its setpoint.
 */
export function toSend(
	list: Wanted[],
	states: Record<string, HaState>,
	memory: Memory,
	brain: BrainSettings,
	now: number
) {
	return list.filter((item) => {
		const last = memory.sent[item.entity];
		const actual = numberOf(states[item.entity], 'temperature');
		const current = brain.dryRun ? (last?.temp ?? actual) : actual;
		const off = !brain.dryRun && !!item.hvacMode && states[item.entity]?.state === 'off';
		if (!off && current !== undefined && Math.abs(current - item.temperature) < 0.05) return false;
		if (item.urgent || !last) return true;
		return now - last.at >= brain.minMinutes * 60_000;
	});
}

/** one round: the plans of every room and what to send */
export function decide(
	inputs: RoomInput[],
	schedules: Record<string, RoomSchedule>,
	brain: BrainSettings,
	states: Record<string, HaState>,
	zone: string | undefined,
	memory: Memory,
	now: number
) {
	const plans = inputs.map((input) =>
		planRoom(input, schedules[input.room.id], brain, memory, now)
	);
	const all = wanted(inputs, plans, brain, states, zone);
	return { plans, wanted: all, send: brain.enabled ? toSend(all, states, memory, brain, now) : [] };
}
