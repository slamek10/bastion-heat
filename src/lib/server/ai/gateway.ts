/**
 * The assistant through bastion-ai: Claude Code on the household's
 * Claude subscription, shared by the Bastion apps. Heat sends the turn
 * (system prompt, message, the session to resume) with a key for its own
 * /mcp tools made for this turn; Claude Code calls them back, and the
 * answer streams in as NDJSON.
 */
import { openTurn, SERVER_NAME } from '$lib/server/ai/mcp';
import type { Conversation, DisplayItem } from '$lib/server/ai/conversations';
import type { TurnEvent } from '$lib/server/ai/assistant';

export interface Limits {
	status?: string;
	window?: string;
	used?: number;
	resetsAt?: number;
	at: number;
}

const global = globalThis as unknown as { __heatLimits?: Limits };

/** how far the subscription's limits were used, as of the last turn */
export const lastLimits = () => global.__heatLimits;

export function gateway() {
	const url = (process.env.BASTION_AI_URL || '').replace(/\/$/, '');
	const token = process.env.BASTION_AI_TOKEN || '';
	if (!url || !token) return undefined;
	// where bastion-ai reaches Heat: APP_URL, or its own address when it differs
	const base = (process.env.BASTION_AI_MCP_URL || process.env.APP_URL || '').replace(/\/$/, '');
	return { url, token, mcpUrl: base.endsWith('/mcp') ? base : `${base}/mcp` };
}

export async function gatewayStatus() {
	const target = gateway();
	if (!target) return undefined;
	try {
		const response = await fetch(`${target.url}/health`, { signal: AbortSignal.timeout(5000) });
		const body = await response.json();
		return { reachable: response.ok, login: !!body.login, model: body.model as string };
	} catch {
		return { reachable: false, login: false };
	}
}

const strip = (name: string) => name.replace(new RegExp(`^mcp__${SERVER_NAME}__`), '');

export async function gatewayTurn({
	conversation,
	message,
	system,
	effort,
	push,
	emit
}: {
	conversation: Conversation;
	message: string;
	system: string;
	effort: 'low' | 'medium' | 'high';
	push: (item: DisplayItem) => void;
	emit: (event: TurnEvent) => void;
}) {
	const target = gateway();
	if (!target) throw new Error('no_gateway');
	if (!target.mcpUrl.startsWith('http')) throw new Error('no_mcp_url');

	const tools = new Map<string, DisplayItem & { kind: 'tool' }>();
	const turn = openTurn({
		conversationId: conversation.id,
		onTool: ({ id, name, summary, ok, effects }) => {
			const item = tools.get(id) ?? {
				kind: 'tool' as const,
				id,
				name: strip(name),
				summary,
				at: Date.now()
			};
			tools.set(id, item);
			if (ok === undefined) {
				emit({ type: 'item', item });
				return;
			}
			item.ok = ok;
			conversation.display.push(item);
			emit({ type: 'item', item });
			if (effects?.proposal) push({ kind: 'proposal', proposal: effects.proposal, at: Date.now() });
		}
	});

	try {
		const response = await fetch(`${target.url}/v1/turn`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				app: 'heat',
				system,
				message,
				...(conversation.session && { session: conversation.session }),
				effort,
				mcp: { name: SERVER_NAME, url: target.mcpUrl, key: turn.key }
			}),
			signal: AbortSignal.timeout(15 * 60_000)
		});
		if (!response.ok || !response.body) {
			const text = await response.text().catch(() => '');
			throw new Error(`gateway ${response.status} ${text}`.trim());
		}
		let written = '';
		const flush = () => {
			if (written.trim()) push({ kind: 'assistant', text: written, at: Date.now() });
			written = '';
		};
		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			let end;
			while ((end = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				if (event.type === 'session') conversation.session = event.id;
				else if (event.type === 'tools' && !event.connected)
					push({ kind: 'error', text: 'tools_down', at: Date.now() });
				else if (event.type === 'text') {
					written += event.text;
					emit({ type: 'text', text: event.text });
				} else if (event.type === 'text_end') flush();
				else if (event.type === 'thinking') emit({ type: 'thinking', text: event.text });
				else if (event.type === 'limits')
					global.__heatLimits = {
						status: event.status,
						window: event.window,
						used: event.used,
						resetsAt: event.resetsAt,
						at: Date.now()
					};
				else if (event.type === 'done') {
					flush();
					if (!event.ok) {
						// a session that can't be resumed (gone, or another server): start over next time
						if (/session|resume/i.test(event.error ?? '')) conversation.session = undefined;
						push({
							kind: 'error',
							text:
								global.__heatLimits?.status === 'rejected'
									? 'limit'
									: String(event.error ?? event.stop ?? 'failed'),
							at: Date.now()
						});
					}
				}
			}
		}
		flush();
	} finally {
		turn.close();
	}
}
