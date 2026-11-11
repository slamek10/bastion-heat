import { describe, expect, it } from 'vitest';
import { aggregate, houseTemperature, readSensor, roomReading } from './rooms';
import type { HaState, Room } from './types';

const NOW = Date.parse('2026-11-11T08:00:00Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const sensor = (entity_id: string, state: string, minutesAgo = 1, reported?: number): HaState => ({
	entity_id,
	state,
	attributes: {},
	last_updated: at(minutesAgo),
	...(reported !== undefined && { last_reported: at(reported) })
});

describe('rooms', () => {
	it('mean, median, lowest', () => {
		expect(aggregate([21, 22, 23.5], 'mean')).toBe(22.2);
		expect(aggregate([21, 22, 23.5, 30], 'median')).toBe(22.8);
		expect(aggregate([21.4, 22], 'min')).toBe(21.4);
		expect(aggregate([], 'mean')).toBeUndefined();
	});

	it('a sensor that stopped reporting is left out; an unchanged one that still reports is not', () => {
		expect(readSensor('a', sensor('a', '21.5', 200), NOW, 90).stale).toBe(true);
		// value unchanged for 200 min, but reported a minute ago
		expect(readSensor('a', sensor('a', '21.5', 200, 1), NOW, 90).stale).toBe(false);
		expect(readSensor('a', sensor('a', 'unavailable'), NOW, 90).stale).toBe(true);
		expect(readSensor('a', undefined, NOW, 90).stale).toBe(true);
	});

	it('combines a room from several sensors, compares with the valve', () => {
		const room: Room = {
			id: 'r',
			name: 'Dnevni',
			sensors: ['sensor.a', 'sensor.b', 'climate.trv'],
			aggregation: 'mean',
			trvs: ['climate.trv'],
			windows: ['binary_sensor.w']
		};
		const states: Record<string, HaState> = {
			'sensor.a': sensor('sensor.a', '21.2'),
			'sensor.b': sensor('sensor.b', '21.8'),
			'climate.trv': {
				entity_id: 'climate.trv',
				state: 'heat',
				attributes: { current_temperature: 22.5, temperature: 21.5, hvac_action: 'heating' },
				last_updated: at(2)
			},
			'binary_sensor.w': sensor('binary_sensor.w', 'off')
		};
		const reading = roomReading(room, states, NOW, 90);
		expect(reading).toMatchObject({
			value: 21.8,
			thermostat: 22.5,
			target: 21.5,
			heating: true,
			windowOpen: false
		});
		expect(reading.used.map((u) => u.stale)).toEqual([false, false, false]);
	});

	it('without valves the main zone tells the target and whether it heats', () => {
		const room: Room = {
			id: 'r',
			name: 'Ured',
			sensors: ['sensor.u'],
			aggregation: 'mean',
			trvs: [],
			windows: []
		};
		const states: Record<string, HaState> = {
			'sensor.u': sensor('sensor.u', '20.9'),
			'climate.zone': {
				entity_id: 'climate.zone',
				state: 'heat',
				attributes: { temperature: 22, hvac_action: 'idle' }
			}
		};
		expect(roomReading(room, states, NOW, 90, 'climate.zone')).toMatchObject({
			value: 20.9,
			target: 22,
			heating: false
		});
	});

	it('the house is the mean of the rooms that have a value', () => {
		expect(houseTemperature([{ value: 21 }, { value: 22 }, { value: undefined }] as never)).toBe(
			21.5
		);
	});
});
