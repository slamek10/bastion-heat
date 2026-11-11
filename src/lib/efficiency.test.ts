import { describe, expect, it } from 'vitest';
import { byMonth, bySeason, consumption, dailyRows, seasonToDate, summarize } from './efficiency';

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
			{ date: '2026-01-10', outdoor: 0, hdd: 18, kwh: 36, metered: true },
			{ date: '2026-01-11', outdoor: 8, hdd: 10, kwh: 15, metered: true },
			{ date: '2026-07-01', outdoor: 22, hdd: 0, kwh: 2, metered: true }
		]);
	});

	it('counts kWh per degree-day from heating days only', () => {
		const [january, july] = summarize(days, byMonth, 0.2);
		expect(january).toMatchObject({ key: '2026-01', hdd: 28, kwh: 51, perHdd: 1.82, cost: 10.2 });
		expect(july.perHdd).toBeUndefined();
	});

	it('leaves days without meter data out of the ratio', () => {
		const gaps = dailyRows(
			[
				{ start: at('2026-01-10'), mean: 0 },
				{ start: at('2026-01-11'), mean: 0 }
			],
			[[{ start: at('2026-01-10'), change: 36 }]]
		);
		const [january] = summarize(gaps, byMonth);
		expect(january).toMatchObject({ hdd: 36, perHdd: 2 });
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

describe('consumption', () => {
	const days = [
		{ date: '2026-11-08', hdd: 10, kwh: 20, metered: true }, // Sunday
		{ date: '2026-11-09', hdd: 10, kwh: 30, metered: true }, // Monday
		{ date: '2026-11-10', hdd: 10, kwh: 0 },
		{ date: '2026-12-01', hdd: 10, kwh: 5, metered: true }
	];

	it('sums by week from Monday, counting metered days', () => {
		expect(consumption(days, 'week', 0.1)).toEqual([
			{ key: '2026-11-02', kwh: 20, metered: 1, days: 1, cost: 2 },
			{ key: '2026-11-09', kwh: 30, metered: 1, days: 2, cost: 3 },
			{ key: '2026-11-30', kwh: 5, metered: 1, days: 1, cost: 0.5 }
		]);
	});

	it('sums by month and year, and keeps a day without data empty', () => {
		expect(consumption(days, 'month').map((b) => [b.key, b.kwh])).toEqual([
			['2026-11-01', 50],
			['2026-12-01', 5]
		]);
		expect(consumption(days, 'year')).toMatchObject([{ key: '2026-01-01', kwh: 55 }]);
		expect(consumption(days, 'day')[2]).toMatchObject({ metered: 0, kwh: 0 });
	});
});
