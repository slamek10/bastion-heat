import { describe, expect, it } from 'vitest';
import { curvePoints, pressureState, targetFlow } from './curve';

describe('heating curve', () => {
	it('matches Bastion HA', () => {
		expect(targetFlow(12.4, 22, 1.1)).toBe(29.5);
		expect(targetFlow(-10, 22, 1.1)).toBe(42.9);
		// warmer outside than the target: no curve, the minimum
		expect(targetFlow(25, 22, 1.1)).toBe(22);
		expect(targetFlow(-30, 24, 3)).toBe(65);
	});

	it('one point a degree from -15 to 20', () => {
		const points = curvePoints(22, 1.1);
		expect(points).toHaveLength(36);
		expect(points[0].outdoor).toBe(-15);
		expect(points.at(-1)!.outdoor).toBe(20);
	});

	it('pressure', () => {
		expect([
			pressureState(0.9),
			pressureState(1.8),
			pressureState(2.5),
			pressureState(undefined)
		]).toEqual(['low', 'ok', 'high', 'unknown']);
	});
});
