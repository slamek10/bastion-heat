/**
 * Heat's tools for Claude Code, as an MCP server (streamable HTTP, plain
 * JSON answers). bastion-ai runs Claude Code on the subscription and
 * points it here for one turn; the key it brings is made for that turn
 * only (10 minutes) and says which conversation the tools act for, so a
 * proposal lands in the right chat. Nothing else can call these tools.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { runTool, summarize, TOOLS } from '$lib/server/ai/tools';
import type { ToolEffects } from '$lib/server/ai/tools';

const TTL = 10 * 60_000;
export const SERVER_NAME = 'heat';
/** how Claude Code names our tools: mcp__heat__rooms */
export const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;

export interface TurnTools {
	conversationId: string;
	/** a tool started / finished, and what it changed */
	onTool?: (event: {
		id: string;
		name: string;
		summary: string;
		ok?: boolean;
		effects?: ToolEffects;
	}) => void;
}

const global = globalThis as unknown as {
	__heatMcp?: Map<string, TurnTools & { expires: number }>;
};
const turns = (global.__heatMcp ??= new Map());

/** a key for one turn; forget it with the returned function when the turn ends */
export function openTurn(turn: TurnTools) {
	const now = Date.now();
	for (const [key, entry] of turns) if (entry.expires <= now) turns.delete(key);
	const key = randomBytes(24).toString('base64url');
	turns.set(key, { ...turn, expires: now + TTL });
	return { key, close: () => turns.delete(key) };
}

function turnFor(header: string | null) {
	const given = header?.match(/^Bearer\s+(\S+)$/)?.[1];
	if (!given) return undefined;
	for (const [key, entry] of turns) {
		const a = Buffer.from(key);
		const b = Buffer.from(given);
		if (a.length === b.length && timingSafeEqual(a, b) && entry.expires > Date.now()) return entry;
	}
	return undefined;
}

const PROTOCOL = '2025-06-18';

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any };

const answer = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const failure = (id: Rpc['id'], code: number, message: string) => ({
	jsonrpc: '2.0',
	id,
	error: { code, message }
});

let callCount = 0;

async function handle(message: Rpc, turn: TurnTools) {
	switch (message.method) {
		case 'initialize':
			return answer(message.id, {
				protocolVersion:
					typeof message.params?.protocolVersion === 'string'
						? message.params.protocolVersion
						: PROTOCOL,
				capabilities: { tools: {} },
				serverInfo: { name: 'bastion-heat', version: '1' }
			});
		case 'ping':
			return answer(message.id, {});
		case 'tools/list':
			return answer(message.id, {
				tools: TOOLS.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.input_schema
				}))
			});
		case 'tools/call': {
			const name = String(message.params?.name ?? '');
			const input = message.params?.arguments ?? {};
			const id = `heat-${++callCount}`;
			const summary = summarize(name, input as Record<string, unknown>);
			turn.onTool?.({ id, name, summary });
			const result = await runTool(name, input, turn.conversationId);
			turn.onTool?.({ id, name, summary, ok: !result.isError, effects: result.effects });
			return answer(message.id, {
				content: [{ type: 'text', text: result.content }],
				isError: !!result.isError
			});
		}
		default:
			return message.id === undefined
				? undefined
				: failure(message.id, -32601, `unknown method ${message.method}`);
	}
}

/** one POST: a message or a batch; notifications get 202 */
export async function mcpRequest(request: Request) {
	const turn = turnFor(request.headers.get('authorization'));
	if (!turn) return new Response('Unauthorized', { status: 401 });
	let body: Rpc | Rpc[];
	try {
		body = await request.json();
	} catch {
		return Response.json(failure(null, -32700, 'parse error'), { status: 400 });
	}
	const list = Array.isArray(body) ? body : [body];
	const out = (await Promise.all(list.map((message) => handle(message, turn)))).filter(Boolean);
	if (!out.length) return new Response(null, { status: 202 });
	return Response.json(Array.isArray(body) ? out : out[0]);
}
