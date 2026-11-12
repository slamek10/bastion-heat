/**
 * Assistant conversations, one JSON file each in data/conversations. The API
 * history (messages) only ever grows: the model's own blocks (thinking,
 * fallback switches) go back exactly as they came, which the current models
 * require. What the page shows (display) is kept beside it.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { config } from '$lib/server/env';
import type { Proposal } from '$lib/types';

export type DisplayItem =
	| { kind: 'user'; text: string; at: number }
	| { kind: 'assistant'; text: string; at: number }
	| { kind: 'tool'; id: string; name: string; summary: string; ok?: boolean; at: number }
	| { kind: 'proposal'; proposal: Proposal; at: number }
	| { kind: 'note'; text: string; at: number }
	| { kind: 'error'; text: string; at: number };

export interface Conversation {
	id: string;
	title: string;
	created: number;
	updated: number;
	messages: Anthropic.Beta.BetaMessageParam[];
	display: DisplayItem[];
}

const MAX_KEPT = 50;
const dir = () => join(config.dataDir, 'conversations');
const ID = /^[0-9a-f-]{36}$/;

export async function loadConversation(id: string): Promise<Conversation | undefined> {
	if (!ID.test(id)) return undefined;
	try {
		return JSON.parse(await readFile(join(dir(), `${id}.json`), 'utf8'));
	} catch {
		return undefined;
	}
}

export async function saveConversation(conversation: Conversation) {
	await mkdir(dir(), { recursive: true });
	conversation.updated = Date.now();
	const path = join(dir(), `${conversation.id}.json`);
	await writeFile(`${path}.tmp`, JSON.stringify(conversation), { mode: 0o600 });
	await rename(`${path}.tmp`, path);
}

export function newConversation(firstMessage: string): Conversation {
	const now = Date.now();
	return {
		id: randomUUID(),
		title: firstMessage.replace(/\s+/g, ' ').slice(0, 80),
		created: now,
		updated: now,
		messages: [],
		display: []
	};
}

export async function listConversations() {
	await mkdir(dir(), { recursive: true });
	const files = (await readdir(dir())).filter((file) => file.endsWith('.json'));
	const all = (
		await Promise.all(files.map((file) => loadConversation(file.replace(/\.json$/, ''))))
	).filter((entry): entry is Conversation => !!entry);
	all.sort((a, b) => b.updated - a.updated);
	// the oldest beyond the limit go
	for (const old of all.slice(MAX_KEPT)) await deleteConversation(old.id);
	return all
		.slice(0, MAX_KEPT)
		.map(({ id, title, created, updated }) => ({ id, title, created, updated }));
}

export async function deleteConversation(id: string) {
	if (!ID.test(id)) return;
	await rm(join(dir(), `${id}.json`), { force: true });
}

/** conversations with a reply being written: notes wait, the reply appends them at its end */
const active = new Map<string, string[]>();

export function beginTurn(id: string) {
	active.set(id, []);
}

/** the notes that came in during the turn, in the order they came */
export function endTurn(id: string) {
	const notes = active.get(id) ?? [];
	active.delete(id);
	return notes;
}

export const turnActive = (id: string) => active.has(id);

export function appendNote(conversation: Conversation, text: string) {
	conversation.messages.push({ role: 'user', content: [{ type: 'text', text }] });
	conversation.display.push({ kind: 'note', text, at: Date.now() });
}

/** something that happened outside the chat (a confirmed or rejected proposal): the model reads it next turn */
export async function noteInConversation(id: string, text: string) {
	const queued = active.get(id);
	if (queued) {
		queued.push(text);
		return;
	}
	const conversation = await loadConversation(id);
	if (!conversation) return;
	appendNote(conversation, text);
	await saveConversation(conversation);
}
