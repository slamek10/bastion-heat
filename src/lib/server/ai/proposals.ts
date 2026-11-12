/**
 * Changes the assistant asks for: a room's weekly schedule, or a room's
 * target. Each one waits for the user's Potvrdi or Odbij on a card in the
 * chat (30 minutes, then it expires) and only then does anything. What
 * happened goes back into the conversation, so Claude reads it next turn.
 * The last 200 are kept in data/proposals.json.
 */
import { randomUUID } from 'node:crypto';
import { loadSettings, read, saveSettings, write } from '$lib/server/store';
import { setOverride, settingsChanged } from '$lib/server/brain';
import { callService, getState } from '$lib/server/ha';
import { noteInConversation } from '$lib/server/ai/conversations';
import { fit } from '$lib/brain';
import { zoneFor } from '$lib/rooms';
import type { Proposal, RoomSchedule } from '$lib/types';

const FILE = 'proposals.json';
const TTL = 30 * 60_000;

async function all() {
	const list = await read<Proposal[]>(FILE, []);
	const now = Date.now();
	for (const entry of list)
		if (entry.status === 'waiting' && entry.expires <= now) entry.status = 'expired';
	return list;
}

const save = (list: Proposal[]) => write(FILE, list.slice(-200));

export const listProposals = async () => (await all()).slice(-50);

export async function propose(
	entry: Omit<Proposal, 'id' | 'created' | 'expires' | 'status'>
): Promise<Proposal> {
	const list = await all();
	// a newer proposal for the same room and kind replaces one still waiting
	for (const old of list)
		if (old.status === 'waiting' && old.roomId === entry.roomId && old.kind === entry.kind)
			old.status = 'expired';
	const now = Date.now();
	const proposal: Proposal = {
		...entry,
		id: randomUUID(),
		created: now,
		expires: now + TTL,
		status: 'waiting'
	};
	list.push(proposal);
	await save(list);
	return proposal;
}

const fmt = (value: number) => value.toFixed(1);

/** "Pon–Pet 06:00–08:00 21.5°; base 19°" */
export function describeSchedule(schedule: RoomSchedule, locale: 'hr' | 'en') {
	const names =
		locale === 'hr'
			? ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned']
			: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const days = (list: number[]) => {
		const sorted = [...list].sort();
		const run = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
		return run && sorted.length > 2
			? `${names[sorted[0] - 1]}–${names[sorted.at(-1)! - 1]}`
			: sorted.map((day) => names[day - 1]).join(', ');
	};
	const blocks = schedule.blocks.map(
		(block) => `${days(block.days)} ${block.from}–${block.to} ${fmt(block.temp)}°`
	);
	return [...blocks, `${locale === 'hr' ? 'inače' : 'otherwise'} ${fmt(schedule.base)}°`].join(
		'; '
	);
}

async function apply(proposal: Proposal) {
	const settings = await loadSettings();
	const room = settings.rooms.find((entry) => entry.id === proposal.roomId);
	if (!room) throw new Error('the room no longer exists');
	if (proposal.kind === 'schedule' && proposal.schedule) {
		await saveSettings({
			...settings,
			schedules: { ...settings.schedules, [room.id]: proposal.schedule }
		});
		await settingsChanged();
		return;
	}
	if (proposal.kind === 'target' && proposal.temperature !== undefined) {
		// a room the brain looks after: held until its schedule next changes
		if (settings.brain.enabled && settings.schedules[room.id]?.enabled) {
			if (!(await setOverride(room.id, proposal.temperature)))
				throw new Error('the room has no schedule');
			return;
		}
		const entities = room.trvs.length
			? room.trvs
			: ([zoneFor(room, settings.entities)].filter(Boolean) as string[]);
		if (!entities.length) throw new Error('nothing in this room takes a target');
		for (const entity_id of entities)
			await callService('climate', 'set_temperature', {
				entity_id,
				temperature: fit(proposal.temperature, getState(entity_id))
			});
		return;
	}
	throw new Error('nothing to change');
}

/** the user's answer on the card */
export async function decide(id: string, confirm: boolean) {
	const list = await all();
	const proposal = list.find((entry) => entry.id === id);
	if (!proposal) return undefined;
	if (proposal.status !== 'waiting') return proposal;
	if (!confirm) proposal.status = 'rejected';
	else {
		try {
			await apply(proposal);
			proposal.status = 'done';
		} catch (error) {
			proposal.status = 'failed';
			proposal.error = (error as Error).message.slice(0, 200);
		}
	}
	await save(list);
	if (proposal.conversationId) {
		const what = `"${proposal.label}" (${proposal.roomName})`;
		const note =
			proposal.status === 'done'
				? `[The user confirmed ${what}; it is applied.]`
				: proposal.status === 'rejected'
					? `[The user rejected ${what}; nothing changed.]`
					: `[The user confirmed ${what}, but it failed: ${proposal.error}]`;
		await noteInConversation(proposal.conversationId, note);
	}
	return proposal;
}
