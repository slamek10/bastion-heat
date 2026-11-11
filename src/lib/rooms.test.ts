import { describe, expect, it } from 'vitest';
import { aggregate, houseTemperature, readSensor, roomReading, zoneFor } from './rooms';
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
			controlled: true,
			old: false,
			windowOpen: false
		});
		expect(reading.used.map((u) => u.stale)).toEqual([false, false, false]);
	});

	it('the main zone belongs only to the room of its thermostat', () => {
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
				attributes: { temperature: 22, hvac_action: 'heating' }
			}
		};
		// a room with only a sensor: nothing to say about heating
		const plain = roomReading(room, states, NOW, 90, zoneFor(room, { zone: 'climate.zone' }));
		expect(plain).toMatchObject({ value: 20.9, heating: false, controlled: false });
		expect(plain.target).toBeUndefined();
		// the room whose sensor is the zone's own temperature
		const own = { ...room, sensors: ['sensor.u'] };
		const zone = zoneFor(own, { zone: 'climate.zone', indoor: 'sensor.u' });
		expect(roomReading(own, states, NOW, 90, zone)).toMatchObject({
			target: 22,
			heating: true,
			controlled: true
		});
	});

	it('keeps the last value, marked old, when every sensor is old', () => {
		const room: Room = {
			id: 'k',
			name: 'Kuhinja',
			sensors: ['sensor.k'],
			aggregation: 'mean',
			trvs: [],
			windows: []
		};
		const reading = roomReading(room, { 'sensor.k': sensor('sensor.k', '23.93', 300) }, NOW, 90);
		expect(reading).toMatchObject({ value: 23.9, old: true });
	});

	it('the house is the mean of the rooms that have a value', () => {
		expect(houseTemperature([{ value: 21 }, { value: 22 }, { value: undefined }] as never)).toBe(
			21.5
		);
	});
});

describe('valves and the central heating', () => {
	const room: Room = {
		id: 'r',
		name: 'Spavaća',
		sensors: ['climate.trv'],
		aggregation: 'mean',
		trvs: ['climate.trv'],
		windows: []
	};
	const states: Record<string, HaState> = {
		'climate.trv': {
			entity_id: 'climate.trv',
			state: 'heat',
			attributes: { current_temperature: 20, temperature: 22, hvac_action: 'heating' },
			last_updated: at(1)
		}
	};
	const zone = (state: string, hvac_action?: string): HaState => ({
		entity_id: 'climate.zone',
		state,
		attributes: hvac_action ? { hvac_action } : {},
		last_updated: at(1)
	});

	it('an open valve heats only while the central heating does', () => {
		expect(roomReading(room, states, NOW, 90, undefined, zone('auto', 'heating'))).toMatchObject({
			heating: true,
			waiting: false
		});
		expect(roomReading(room, states, NOW, 90, undefined, zone('off'))).toMatchObject({
			heating: false,
			waiting: true
		});
		expect(roomReading(room, states, NOW, 90, undefined, zone('auto', 'idle'))).toMatchObject({
			heating: false,
			waiting: true
		});
	});

	it('an unknown central heating stops nothing', () => {
		expect(roomReading(room, states, NOW, 90).heating).toBe(true);
		expect(roomReading(room, states, NOW, 90, undefined, zone('unavailable')).heating).toBe(true);
		expect(roomReading(room, states, NOW, 90, undefined, zone('heat')).heating).toBe(true);
	});
});
