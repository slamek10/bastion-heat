import { describe, expect, it } from 'vitest';
import { byMonth, bySeason, dailyRows, seasonToDate, summarize } from './efficiency';

const at = (date: string) => new Date(`${date}T00:00:00`).getTime();

describe('efficiency', () => {
	const days = dailyRows(
		[
			{ start: at('2026-01-10'), mean: 0 },
			{ start: at('2026-01-11'), mean: 8 },
			{ start: new Date(`2026-07-01T00:00:00`).toISOString(), mean: 22 }
		],
		[
			[
				{ start: at('2026-01-10'), change: 30 },
				{ start: at('2026-01-11'), change: 15 },
				{ start: at('2026-07-01'), change: 2 }
			],
			[
				{ start: at('2026-01-10'), change: 6 },
				{ start: at('2026-01-11'), change: -400 }
			]
		]
	);

	it('makes days with degree-days and summed meters, a meter reset left out', () => {
		expect(days).toEqual([
			{ date: '2026-01-10', outdoor: 0, hdd: 18, kwh: 36 },
			{ date: '2026-01-11', outdoor: 8, hdd: 10, kwh: 15 },
			{ date: '2026-07-01', outdoor: 22, hdd: 0, kwh: 2 }
		]);
	});

	it('counts kWh per degree-day from heating days only', () => {
		const [january, july] = summarize(days, byMonth, 0.2);
		expect(january).toMatchObject({ key: '2026-01', hdd: 28, kwh: 51, perHdd: 1.82, cost: 10.2 });
		expect(july.perHdd).toBeUndefined();
	});

	it('groups by season', () => {
		expect(summarize(days, bySeason).map((p) => p.key)).toEqual(['2025/26', '2026/27']);
	});

	it('compares this season with the last one up to the same day', () => {
		const both = dailyRows(
			[
				{ start: at('2025-11-01'), mean: 5 },
				{ start: at('2025-12-01'), mean: 0 },
				{ start: at('2026-11-01'), mean: 5 }
			],
			[
				[
					{ start: at('2025-11-01'), change: 26 },
					{ start: at('2025-12-01'), change: 50 },
					{ start: at('2026-11-01'), change: 13 }
				]
			]
		);
		const result = seasonToDate(both, new Date('2026-11-11T12:00:00'));
		expect(result.now?.perHdd).toBe(1);
		expect(result.before?.perHdd).toBe(2);
		expect(result.change).toBe(-50);
	});
});
