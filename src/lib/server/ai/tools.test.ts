import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runTool, validate } from './tools';
import { decide, describeSchedule, listProposals } from './proposals';
import { loadSettings } from '$lib/server/store';

beforeAll(() => {
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'heat-ai-'));
});

describe('tool input', () => {
	it('checks types, ranges and nested blocks', () => {
		expect(() => validate('history', {})).toThrow('hours is required');
		expect(() => validate('history', { hours: 500 })).toThrow('above');
		expect(() =>
			validate('propose_target', { room_id: 'x', temperature: '21', reason: 'r' })
		).toThrow('number');
		expect(() =>
			validate('propose_schedule', {
				room_id: 'x',
				enabled: true,
				base: 19,
				blocks: [{ days: [8], from: '06:00', to: '08:00', temp: 21 }],
				reason: 'r'
			})
		).toThrow('blocks[0].days[0]');
		expect(() => validate('rooms', { extra: 1 })).toThrow('unknown field');
	});
});

describe('proposals', () => {
	it('a schedule waits for Potvrdi, then is saved', async () => {
		const result = await runTool(
			'propose_schedule',
			{
				room_id: 'office',
				enabled: true,
				base: 18,
				blocks: [{ days: [1, 2, 3, 4, 5], from: '07:30', to: '16:00', temp: 21.5 }],
				reason: 'radni dan'
			},
			'00000000-0000-0000-0000-000000000000'
		);
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content).status).toBe('waiting_for_user');
		const proposal = result.effects!.proposal!;
		expect(proposal.label).toBe('Pon–Pet 07:30–16:00 21.5°; inače 18.0°');
		expect((await loadSettings()).schedules.office).toBeUndefined();

		const done = await decide(proposal.id, true);
		expect(done?.status).toBe('done');
		expect((await loadSettings()).schedules.office?.blocks).toHaveLength(1);
		// answered once: a second press changes nothing
		expect((await decide(proposal.id, false))?.status).toBe('done');
	});

	it('invalid blocks are refused, not dropped silently', async () => {
		const result = await runTool(
			'propose_schedule',
			{
				room_id: 'office',
				enabled: true,
				base: 18,
				blocks: [{ days: [1], from: '22:00', to: '06:00', temp: 20 }],
				reason: 'noć'
			},
			'c'
		);
		expect(result.isError).toBe(true);
		expect(result.content).toContain('overnight');
	});

	it('a rejected target changes nothing', async () => {
		const result = await runTool(
			'propose_target',
			{ room_id: 'bedroom', temperature: 20.3, reason: 'r' },
			'c'
		);
		const proposal = result.effects!.proposal!;
		expect(proposal.temperature).toBe(20.5);
		expect((await decide(proposal.id, false))?.status).toBe('rejected');
		expect((await listProposals()).find((entry) => entry.id === proposal.id)?.status).toBe(
			'rejected'
		);
	});

	it('an unknown room is an input error', async () => {
		const result = await runTool(
			'propose_target',
			{ room_id: 'nope', temperature: 20, reason: 'r' },
			'c'
		);
		expect(result.content).toMatch(/^INVALID_INPUT/);
	});
});

describe('describeSchedule', () => {
	it('names days and the base', () => {
		expect(
			describeSchedule(
				{
					enabled: true,
					base: 19,
					blocks: [{ days: [6, 7], from: '08:00', to: '22:00', temp: 21 }]
				},
				'en'
			)
		).toBe('Sat, Sun 08:00–22:00 21.0°; otherwise 19.0°');
	});
});
