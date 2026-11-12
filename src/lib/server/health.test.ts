import { describe, expect, it } from 'vitest';
import { heatingEdges, temperaturePoints } from './health';

describe('history rows', () => {
	it('a valve heats while its hvac_action says so, attributes carried forward', () => {
		const { edges, hasAction } = heatingEdges(
			[
				{ s: 'heat', a: { hvac_action: 'idle', current_temperature: 20 }, lu: 100 },
				{ s: 'heat', a: { hvac_action: 'heating', current_temperature: 20 }, lu: 200 },
				{ s: 'heat', lu: 300 },
				{ s: 'off', a: { hvac_action: 'heating' }, lu: 400 }
			],
			true
		);
		expect(hasAction).toBe(true);
		expect(edges.map((edge) => edge.on)).toEqual([false, true, true, false]);
		expect(edges[0].t).toBe(100_000);
	});

	it('a valve without hvac_action heats while it is set to heat', () => {
		const { edges, hasAction } = heatingEdges([{ s: 'heat', a: {}, lu: 1 }], true);
		expect(hasAction).toBe(false);
		expect(edges[0].on).toBe(true);
		expect(heatingEdges([{ s: 'heat', a: {}, lu: 1 }], false).edges[0].on).toBe(false);
	});

	it('temperatures: climate by current_temperature, sensors by state', () => {
		expect(
			temperaturePoints('climate.x', [
				{ s: 'heat', a: { current_temperature: 21.5 }, lu: 1 },
				{ s: 'heat', lu: 2 }
			])
		).toEqual([
			{ t: 1000, v: 21.5 },
			{ t: 2000, v: 21.5 }
		]);
		expect(
			temperaturePoints('sensor.x', [
				{ s: '20.1', lu: 1 },
				{ s: 'unavailable', lu: 2 }
			])
		).toEqual([{ t: 1000, v: 20.1 }]);
	});
});
