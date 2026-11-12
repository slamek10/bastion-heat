/**
 * The brain's round, every minute: rooms as they are, the plan for each
 * (lib/brain.ts), and the setpoints that change go to Home Assistant, or in
 * the trial mode only into the decision log. What it remembers (who asks
 * for heat, manual changes, what was sent) lives in data/brain.json, the
 * log in data/decisions.json (the last 5000).
 */
import { loadSettings, read, write } from '$lib/server/store';
import { callService, haReady, watchedStates } from '$lib/server/ha';
import { currentRooms } from '$lib/server/heat';
import { publish } from '$lib/server/bus';
import { decide, emptyMemory, nextChange, type Memory, type RoomPlan } from '$lib/brain';
import { zoneFor } from '$lib/rooms';
import type { BrainStatus, Decision } from '$lib/types';

const LOG = 'decisions.json';

interface State {
	started: boolean;
	memory?: Memory;
	plans: RoomPlan[];
	recent: Decision[];
	running: boolean;
}
const global = globalThis as unknown as { __heatBrain?: State };
const state: State = (global.__heatBrain ??= {
	started: false,
	plans: [],
	recent: [],
	running: false
});

async function memory() {
	if (!state.memory) {
		state.memory = { ...emptyMemory(), ...(await read<Partial<Memory>>('brain.json', {})) };
		state.recent = (await read<Decision[]>(LOG, [])).slice(-20).reverse();
	}
	return state.memory;
}

const saveMemory = () => write('brain.json', state.memory);

async function logDecisions(list: Decision[]) {
	if (!list.length) return;
	const log = await read<Decision[]>(LOG, []);
	log.push(...list);
	await write(LOG, log.slice(-5000));
	state.recent = [...list.reverse(), ...state.recent].slice(0, 20);
}

export async function brainStatus(): Promise<BrainStatus> {
	const settings = await loadSettings();
	await memory();
	return {
		enabled: settings.brain.enabled,
		dryRun: settings.brain.dryRun,
		plans: state.plans,
		recent: state.recent
	};
}

export async function round() {
	if (state.running) return;
	state.running = true;
	try {
		const settings = await loadSettings();
		const mem = await memory();
		const now = Date.now();
		// manual changes that ran out
		for (const [id, override] of Object.entries(mem.overrides))
			if (override.until <= now) delete mem.overrides[id];

		const inputs = (await currentRooms()).map(({ room, reading }) => ({
			room,
			reading,
			zone: zoneFor(room, settings.entities)
		}));
		const states = watchedStates();
		const result = decide(
			inputs,
			settings.schedules,
			settings.brain,
			states,
			settings.entities.zone,
			mem,
			now
		);
		state.plans = result.plans;
		for (const plan of result.plans) {
			if (plan.managed) mem.calling[plan.roomId] = plan.calling;
			else delete mem.calling[plan.roomId];
		}

		const done: Decision[] = [];
		const live = settings.brain.enabled && !settings.brain.dryRun;
		if (!live || haReady()) {
			for (const item of result.send) {
				const decision: Decision = {
					at: now,
					entity: item.entity,
					kind: item.kind,
					...(item.roomId && { roomId: item.roomId }),
					temperature: item.temperature,
					reason: item.reason,
					vars: item.vars,
					dry: !live
				};
				if (live) {
					try {
						if (item.hvacMode)
							await callService('climate', 'set_hvac_mode', {
								entity_id: item.entity,
								hvac_mode: item.hvacMode
							});
						await callService('climate', 'set_temperature', {
							entity_id: item.entity,
							temperature: item.temperature
						});
					} catch (error) {
						decision.error = (error as Error).message.slice(0, 200);
					}
				}
				// a failed command is tried again after the gap, not every minute
				mem.sent[item.entity] = { at: now, temp: item.temperature, ...(!live && { dry: true }) };
				done.push(decision);
			}
		}
		await logDecisions(done);
		await saveMemory();
		publish({ kind: 'brain', brain: await brainStatus() });
	} finally {
		state.running = false;
	}
}

/**
 * A change from the page: the room is held at this temperature until its
 * schedule next changes (three hours when it never does); null goes back
 * to the schedule.
 */
export async function setOverride(roomId: string, temp: number | null) {
	const settings = await loadSettings();
	const schedule = settings.schedules[roomId];
	const room = settings.rooms.find((entry) => entry.id === roomId);
	if (!room || !schedule?.enabled) return false;
	const mem = await memory();
	// the user's own change goes out now, not after the gap between commands
	for (const id of [...room.trvs, settings.entities.zone]) delete mem.sent[id];
	if (temp === null) delete mem.overrides[roomId];
	else {
		const now = Date.now();
		mem.overrides[roomId] = { temp, until: nextChange(schedule, now) ?? now + 3 * 3_600_000 };
	}
	await saveMemory();
	await round();
	return true;
}

/** after the settings change: the trial log starts over, so the new rules show at once */
export async function settingsChanged() {
	const mem = await memory();
	mem.sent = {};
	await saveMemory();
	await round().catch(() => {});
}

/** the last setpoint sent to each device, for the valves' health */
export async function sentCommands() {
	return { ...(await memory()).sent };
}

/** the plan of each room, as of the last round */
export const currentPlans = () => state.plans;

export const decisions = () => read<Decision[]>(LOG, []);

export function startBrain() {
	if (state.started || process.env.BRAIN === 'off') return;
	state.started = true;
	setTimeout(() => round().catch(() => {}), 30_000);
	setInterval(
		() => round().catch((error) => console.warn('[brain]', (error as Error).message)),
		60_000
	).unref?.();
}
