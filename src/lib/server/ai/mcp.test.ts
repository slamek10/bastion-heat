import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { keyFor, mcpRequest, openTurn } from './mcp';

beforeAll(() => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'heat-mcp-'));
});

const post = (body: unknown, key?: string) =>
	mcpRequest(
		new Request('http://heat/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(key && { Authorization: `Bearer ${key}` })
			},
			body: JSON.stringify(body)
		})
	);

describe('mcp', () => {
	it('refuses without the turn key, and after the turn', async () => {
		expect((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
		const turn = openTurn({ conversationId: 'c' });
		expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, turn.key)).status).toBe(200);
		turn.close();
		expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, turn.key)).status).toBe(401);
	});

	it('initialize, the tool list, a notification', async () => {
		const turn = openTurn({ conversationId: 'c' });
		const init = await (
			await post(
				{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
				turn.key
			)
		).json();
		expect(init.result.serverInfo.name).toBe('bastion-heat');
		expect(init.result.capabilities.tools).toEqual({});
		expect(
			(await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, turn.key)).status
		).toBe(202);
		const list = await (
			await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, turn.key)
		).json();
		const names = list.result.tools.map((tool: { name: string }) => tool.name);
		expect(names).toContain('rooms');
		expect(names).toContain('propose_schedule');
		turn.close();
	});

	it("a call runs the tool for the turn's conversation and reports it", async () => {
		const seen: { name: string; ok?: boolean; proposal?: string }[] = [];
		const turn = openTurn({
			conversationId: 'conv-1',
			onTool: (event) =>
				seen.push({
					name: event.name,
					ok: event.ok,
					proposal: event.effects?.proposal?.conversationId
				})
		});
		const answer = await (
			await post(
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: {
						name: 'propose_target',
						arguments: { room_id: 'office', temperature: 21, reason: 'r' }
					}
				},
				turn.key
			)
		).json();
		expect(answer.result.isError).toBe(false);
		expect(JSON.parse(answer.result.content[0].text).status).toBe('waiting_for_user');
		expect(seen).toEqual([
			{ name: 'propose_target', ok: undefined, proposal: undefined },
			{ name: 'propose_target', ok: true, proposal: 'conv-1' }
		]);
		const bad = await (
			await post(
				{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'history', arguments: {} } },
				turn.key
			)
		).json();
		expect(bad.result.isError).toBe(true);
		turn.close();
	});
});

describe('a key for the house assistant', () => {
	const TOKEN = 'g'.repeat(40);
	const listNames = async (key: string) =>
		(
			await (
				await mcpRequest(
					new Request('http://app/mcp', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
						body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
					})
				)
			).json()
		).result.tools.map((tool: { name: string }) => tool.name);

	it("only with bastion-ai's token, and only the reading tools", async () => {
		process.env.BASTION_AI_TOKEN = TOKEN;
		expect(keyFor(null)).toBeUndefined();
		expect(keyFor('Bearer wrong')).toBeUndefined();
		const key = keyFor(`Bearer ${TOKEN}`)!;
		expect(key).toBeTruthy();
		const names = await listNames(key);
		expect(names.length).toBeGreaterThan(0);
		expect(names.filter((name: string) => /^propose_|^request_action$/.test(name))).toEqual([]);
		delete process.env.BASTION_AI_TOKEN;
	});

	it('nothing without a token set', () => {
		delete process.env.BASTION_AI_TOKEN;
		expect(keyFor(`Bearer ${TOKEN}`)).toBeUndefined();
	});
});
