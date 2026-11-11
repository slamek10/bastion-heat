import { describe, expect, it } from 'vitest';
import { comfort, heatingHours, meanTarget, roomWeek, tips } from './report';

const H = 3_600_000;
const start = 1_000 * H;
const s = (ms: number) => ms / 1000;

describe('report', () => {
	const rows = [
		{ s: 'heat', a: { hvac_action: 'heating', temperature: 22 }, lu: s(start - 2 * H) },
		{ s: 'heat', a: { hvac_action: 'idle', temperature: 22 }, lu: s(start + 3 * H) },
		{ s: 'heat', a: { hvac_action: 'preheating', temperature: 20 }, lu: s(start + 5 * H) },
		{ s: 'off', a: { hvac_action: 'off', temperature: 30 }, lu: s(start + 6 * H) }
	];

	it('counts heating hours inside the window', () => {
		expect(heatingHours(rows, start, start + 8 * H)).toBe(4);
	});

	it('weights the target by time and leaves off out', () => {
		// 5 h at 22, 1 h at 20
		expect(meanTarget(rows, start, start + 8 * H)).toBe(21.7);
	});

	it('finds the comfort target past a night setback and a short boost', () => {
		const week = [
			{ s: 'auto', a: { temperature: 21.5 }, lu: s(start) },
			{ s: 'auto', a: { temperature: 15 }, lu: s(start + 14 * H) },
			{ s: 'auto', a: { temperature: 21.5 }, lu: s(start + 24 * H) },
			{ s: 'auto', a: { temperature: 25 }, lu: s(start + 30 * H) },
			{ s: 'auto', a: { temperature: 21.5 }, lu: s(start + 31 * H) }
		];
		const found = comfort(week, start, start + 40 * H)!;
		expect(found.target).toBe(21.5);
		expect(found.at(start + 2 * H)).toBe(true);
		expect(found.at(start + 20 * H)).toBe(false);
		// the room's average only over comfort hours
		const rows = [
			{ start: start, mean: 22 },
			{ start: start + 20 * H, mean: 16 }
		];
		expect(roomWeek([rows], 'mean', found.at)).toMatchObject({ avg: 19, comfortAvg: 22 });
	});

	it('combines sensors hour by hour', () => {
		const week = roomWeek(
			[
				[
					{ start: 1, mean: 20, min: 19, max: 21 },
					{ start: 2, mean: 22, min: 21, max: 23 }
				],
				[{ start: 1, mean: 18, min: 17, max: 19 }]
			],
			'mean'
		);
		expect(week).toEqual({ avg: 20.5, min: 18, max: 23 });
		expect(roomWeek([], 'mean')).toBeUndefined();
	});

	it('gives tips from the numbers', () => {
		const result = tips(
			[
				{ id: 'a', name: 'Dnevni', avg: 23.4, target: 22, airing: 0, cold: 0 },
				{ id: 'b', name: 'Ured', avg: 19.5, target: 21, heatingHours: 100, airing: 4, cold: 0 },
				{ id: 'c', name: 'Soba', avg: 20, target: 21, heatingHours: 10, airing: 0, cold: 1 }
			],
			{ perHdd: 2.4, previousPerHdd: 2 }
		);
		expect(result.map((tip) => tip.key)).toEqual([
			'tip_too_warm',
			'tip_struggles',
			'tip_humid',
			'tip_cold',
			'tip_eff_worse'
		]);
		expect(result[0].vars.d).toBe('1.4');
		expect(tips([], {})).toEqual([{ key: 'tip_all_good', vars: {} }]);
	});
});
