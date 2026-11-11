import { describe, expect, it } from 'vitest';
import { absoluteHumidity, airingAdvice, degreeDays, dewPoint, seasonOf, tooCold } from './comfort';

const limits = { humidity: 60, co2: 1000 };

describe('air', () => {
	it('absolute humidity and dew point', () => {
		expect(absoluteHumidity(21, 60)).toBeCloseTo(11, 0);
		expect(absoluteHumidity(0, 90)).toBeCloseTo(4.4, 0);
		expect(dewPoint(21, 60)).toBeCloseTo(12.9, 0);
	});

	it('humid inside, cold and "humid" outside: airing still dries the room', () => {
		const advice = airingAdvice(
			{ temperature: 21, humidity: 68, windowOpen: false },
			{ temperature: 2, humidity: 90 },
			limits
		);
		expect(advice?.reason).toBe('humidity');
		expect(advice!.value).toBeGreaterThan(5);
	});

	it('no advice when outside is as wet, when it is dry enough inside, or a window is open', () => {
		expect(
			airingAdvice(
				{ temperature: 24, humidity: 65, windowOpen: false },
				{ temperature: 24, humidity: 62 },
				limits
			)
		).toBeUndefined();
		expect(
			airingAdvice(
				{ temperature: 21, humidity: 50, windowOpen: false },
				{ temperature: 2, humidity: 90 },
				limits
			)
		).toBeUndefined();
		expect(
			airingAdvice(
				{ temperature: 21, humidity: 70, windowOpen: true },
				{ temperature: 2, humidity: 90 },
				limits
			)
		).toBeUndefined();
	});

	it('CO₂ first', () => {
		expect(airingAdvice({ co2: 1400, windowOpen: false }, {}, limits)).toEqual({
			reason: 'co2',
			value: 1400
		});
	});
});

describe('cold and degree days', () => {
	it('too cold below the limit only', () => {
		expect(tooCold(9.5, 10)).toBe(true);
		expect(tooCold(10, 10)).toBe(false);
		expect(tooCold(undefined, 10)).toBe(false);
	});

	it('degree days count only heating days', () => {
		expect(degreeDays(5)).toBe(13);
		expect(degreeDays(14.9)).toBe(3.1);
		expect(degreeDays(16)).toBe(0);
	});

	it('the season runs July to June', () => {
		expect(seasonOf(new Date(2026, 10, 11))).toBe('2026/27');
		expect(seasonOf(new Date(2027, 1, 1))).toBe('2026/27');
		expect(seasonOf(new Date(2026, 5, 30))).toBe('2025/26');
	});
});
