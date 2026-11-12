import { describe, expect, it } from 'vitest';
import {
	combine,
	heatRate,
	heatRuns,
	hoursOn,
	intersect,
	minutesToTarget,
	quotaOf,
	spansOf,
	stalled,
	trackWarming,
	union,
	valveHealth
} from './health';
import type { HaState } from './types';

const MIN = 60_000;
const H = 3_600_000;
const NOW = Date.parse('2026-11-12T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

function valve(state: string, temperature?: number, changed = NOW - H): HaState {
	return {
		entity_id: 'climate.trv',
		state,
		attributes: temperature !== undefined ? { temperature } : {},
		last_changed: iso(changed),
		last_reported: iso(NOW - 2 * MIN)
	};
}
const battery = (level: string): HaState => ({
	entity_id: 'sensor.b',
	state: level,
	attributes: {}
});

describe('valveHealth', () => {
	it('reads the battery and when it last reported', () => {
		const health = valveHealth(
			'climate.trv',
			'r',
			valve('heat', 21),
			battery('64'),
			undefined,
			20,
			NOW
		);
		expect(health).toMatchObject({ battery: 64, batteryLow: false, offline: false });
		expect(health.lastSeen).toBe(NOW - 2 * MIN);
		expect(health.notResponding).toBeUndefined();
	});

	it('a battery at or below the limit is low', () => {
		expect(
			valveHealth('climate.trv', 'r', valve('heat'), battery('20'), undefined, 20, NOW).batteryLow
		).toBe(true);
	});

	it('is offline only after half an hour unavailable', () => {
		expect(
			valveHealth(
				'climate.trv',
				'r',
				valve('unavailable', undefined, NOW - 10 * MIN),
				undefined,
				undefined,
				20,
				NOW
			).offline
		).toBe(false);
		expect(
			valveHealth(
				'climate.trv',
				'r',
				valve('unavailable', undefined, NOW - 31 * MIN),
				undefined,
				undefined,
				20,
				NOW
			).offline
		).toBe(true);
		expect(valveHealth('climate.trv', 'r', undefined, undefined, undefined, 20, NOW).offline).toBe(
			true
		);
	});

	it("doesn't answer: the brain's setpoint not taken after 15 minutes", () => {
		const sent = { at: NOW - 16 * MIN, temp: 23 };
		expect(
			valveHealth('climate.trv', 'r', valve('heat', 5), undefined, sent, 20, NOW).notResponding
		).toEqual({
			asked: 23,
			actual: 5,
			since: NOW - 16 * MIN
		});
	});

	it('answers: taken, still within 15 minutes, or only the trial mode', () => {
		const check = (sent: { at: number; temp: number; dry?: boolean }, actual: number) =>
			valveHealth('climate.trv', 'r', valve('heat', actual), undefined, sent, 20, NOW)
				.notResponding;
		expect(check({ at: NOW - H, temp: 23 }, 23)).toBeUndefined();
		expect(check({ at: NOW - 5 * MIN, temp: 23 }, 5)).toBeUndefined();
		expect(check({ at: NOW - H, temp: 23, dry: true }, 5)).toBeUndefined();
	});
});

describe('quotaOf', () => {
	it('the limit is used plus remaining, projected at the month so far', () => {
		// 12 November noon: 11.5 of 30 days gone
		const quota = quotaOf(3000, 7000, new Date(2026, 10, 12, 12))!;
		expect(quota.limit).toBe(10000);
		expect(quota.used).toBeCloseTo(0.3);
		expect(quota.projected).toBe(Math.round((3000 * 30) / 11.5));
	});

	it('no projection on the first day', () => {
		expect(quotaOf(50, 9950, new Date(2026, 10, 1, 10))!.projected).toBeUndefined();
	});
});

describe('spans', () => {
	it('on/off moments into stretches, the last one open until the end', () => {
		const spans = spansOf(
			[
				{ t: 0, on: true },
				{ t: 10, on: false },
				{ t: 20, on: true },
				{ t: 25, on: true },
				{ t: 30, on: false },
				{ t: 40, on: true }
			],
			50
		);
		expect(spans).toEqual([
			{ from: 0, to: 10 },
			{ from: 20, to: 30 },
			{ from: 40, to: 50 }
		]);
	});

	it('union joins overlaps, intersect keeps both', () => {
		expect(
			union([
				[{ from: 0, to: 10 }],
				[
					{ from: 5, to: 15 },
					{ from: 20, to: 30 }
				]
			])
		).toEqual([
			{ from: 0, to: 15 },
			{ from: 20, to: 30 }
		]);
		expect(intersect([{ from: 0, to: 15 }], [{ from: 10, to: 30 }])).toEqual([
			{ from: 10, to: 15 }
		]);
	});

	it('hours on within a window', () => {
		expect(
			hoursOn(
				[
					{ from: 0, to: 2 * H },
					{ from: 3 * H, to: 5 * H }
				],
				H,
				4 * H
			)
		).toBe(2);
	});
});

describe('heat-up rate', () => {
	const temps = [
		{ t: 0, v: 20 },
		{ t: H, v: 21 },
		{ t: 2 * H, v: 21.2 },
		{ t: 3 * H, v: 20.6 },
		{ t: 4 * H, v: 21.6 }
	];

	it('each long enough heating stretch with its rise and °C/h', () => {
		const runs = heatRuns(temps, [
			{ from: 0, to: H },
			{ from: 3 * H, to: 4 * H },
			{ from: 2 * H, to: 2 * H + 10 * MIN }
		]);
		expect(runs.map((run) => [run.rise, run.rate])).toEqual([
			[1, 1],
			[1, 1]
		]);
	});

	it('the median of the stretches that warmed the room', () => {
		const runs = [
			{ from: 0, to: H, rise: 0.4, rate: 0.4 },
			{ from: 0, to: H, rise: 1.2, rate: 1.2 },
			{ from: 0, to: H, rise: 0.8, rate: 0.8 },
			{ from: 0, to: H, rise: -0.1, rate: -0.1 }
		];
		expect(heatRate(runs)).toBe(0.8);
		expect(heatRate([])).toBeUndefined();
	});

	it('time to target, in 5 minutes', () => {
		expect(minutesToTarget(20.5, 21.5, 0.8)).toBe(75);
		expect(minutesToTarget(21.6, 21.5, 0.8)).toBeUndefined();
		expect(minutesToTarget(20, 21, undefined)).toBeUndefined();
	});

	it('several sensors combine into one line', () => {
		const line = combine(
			[
				[{ t: 0, v: 20 }],
				[
					{ t: 0, v: 22 },
					{ t: 10 * MIN, v: 24 }
				]
			],
			0,
			10 * MIN
		);
		expect(line).toEqual([
			{ t: 0, v: 21 },
			{ t: 5 * MIN, v: 21 },
			{ t: 10 * MIN, v: 22 }
		]);
	});
});

describe('a room that is not warming', () => {
	it('two hours heating without 0.2 °C more', () => {
		let warming = trackWarming(undefined, true, 19, 0);
		warming = trackWarming(warming, true, 19.1, H);
		expect(stalled(warming, H)).toBe(false);
		warming = trackWarming(warming, true, 19.1, 2 * H);
		expect(stalled(warming, 2 * H)).toBe(true);
	});

	it('getting warmer or stopping starts over', () => {
		let warming = trackWarming(undefined, true, 19, 0);
		warming = trackWarming(warming, true, 19.3, 90 * MIN);
		expect(warming).toEqual({ since: 90 * MIN, start: 19.3 });
		expect(stalled(warming, 2 * H)).toBe(false);
		expect(trackWarming(warming, false, 19.3, 2 * H)).toBeUndefined();
	});
});
