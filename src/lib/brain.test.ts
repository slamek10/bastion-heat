import { describe, expect, it } from 'vitest';
import { decide, emptyMemory, fit, nextChange, scheduleTarget, toSend } from '$lib/brain';
import { DEFAULT_SETTINGS, type HaState, type Room, type RoomReading } from '$lib/types';

const brain = { ...DEFAULT_SETTINGS.brain, enabled: true, dryRun: false };
const ZONE = 'climate.zone';
const trv = (id: string, temperature: number, extra: Record<string, unknown> = {}): HaState => ({
	entity_id: id,
	state: 'heat',
	attributes: { temperature, min_temp: 5, max_temp: 30, target_temp_step: 0.5, ...extra }
});
const room = (id: string, trvs: string[] = [], sensors = [`sensor.${id}`]): Room => ({
	id,
	name: id,
	sensors,
	aggregation: 'mean',
	trvs,
	windows: []
});
const reading = (roomId: string, value?: number, windowOpen = false): RoomReading => ({
	roomId,
	value,
	used: [],
	heating: false,
	waiting: false,
	controlled: true,
	old: false,
	windowOpen
});
const allWeek = [1, 2, 3, 4, 5, 6, 7];
const schedule = (temp = 21, base = 18) => ({
	enabled: true,
	base,
	blocks: [{ days: allWeek, from: '06:00', to: '22:00', temp }]
});
// Wednesday 2026-11-11 at 10:00 local time
const now = new Date(2026, 10, 11, 10, 0).getTime();

describe('schedule', () => {
	it('picks the block, else the base', () => {
		const s = {
			enabled: true,
			base: 18,
			blocks: [
				{ days: [1, 2, 3, 4, 5], from: '06:00', to: '08:00', temp: 21 },
				{ days: [6, 7], from: '08:00', to: '23:00', temp: 22 }
			]
		};
		expect(scheduleTarget(s, new Date(2026, 10, 11, 7, 0)).temp).toBe(21);
		expect(scheduleTarget(s, new Date(2026, 10, 11, 8, 0)).temp).toBe(18);
		expect(scheduleTarget(s, new Date(2026, 10, 14, 9, 0)).temp).toBe(22); // Saturday
	});

	it('finds the next change, skipping one to the same temperature', () => {
		expect(nextChange(schedule(), now)).toBe(new Date(2026, 10, 11, 22, 0).getTime());
		const night = new Date(2026, 10, 11, 23, 0).getTime();
		expect(nextChange(schedule(), night)).toBe(new Date(2026, 10, 12, 6, 0).getTime());
	});
});

describe('fit', () => {
	it('rounds to the step and keeps to the limits', () => {
		expect(fit(21.3, trv('a', 0))).toBe(21.5);
		expect(fit(3, trv('a', 0))).toBe(5);
		expect(fit(33, trv('a', 0, { max_temp: 28 }))).toBe(28);
	});
});

describe('decide', () => {
	const states = { 'climate.v1': trv('climate.v1', 21), [ZONE]: trv(ZONE, 21) };
	const inputs = (value: number | undefined, windowOpen = false) => [
		{ room: room('bed', ['climate.v1']), reading: reading('bed', value, windowOpen) }
	];

	it('leaves rooms without a schedule alone', () => {
		const result = decide(inputs(18), {}, brain, states, ZONE, emptyMemory(), now);
		expect(result.plans[0].managed).toBe(false);
		expect(result.wanted).toEqual([]);
	});

	it('opens the valve and raises the zone when the room is cold', () => {
		const result = decide(inputs(19), { bed: schedule() }, brain, states, ZONE, emptyMemory(), now);
		expect(result.plans[0]).toMatchObject({ calling: true, target: 21, source: 'schedule' });
		expect(result.wanted).toEqual([
			expect.objectContaining({ entity: 'climate.v1', temperature: 23, reason: 'brain_trv_open' }),
			expect.objectContaining({ entity: ZONE, temperature: 21, reason: 'brain_zone_demand' })
		]);
	});

	it('uses hysteresis: a warm room asks again only below target − 0.3', () => {
		const warm = emptyMemory();
		expect(
			decide(inputs(20.8), { bed: schedule() }, brain, states, ZONE, warm, now).plans[0].calling
		).toBe(false);
		const heating = { ...emptyMemory(), calling: { bed: true } };
		expect(
			decide(inputs(20.8), { bed: schedule() }, brain, states, ZONE, heating, now).plans[0].calling
		).toBe(true);
		expect(
			decide(inputs(21), { bed: schedule() }, brain, states, ZONE, heating, now).plans[0].calling
		).toBe(false);
	});

	it('closes the valve and puts the zone on eco when every room is warm', () => {
		const result = decide(
			inputs(21.5),
			{ bed: schedule() },
			brain,
			states,
			ZONE,
			emptyMemory(),
			now
		);
		expect(result.wanted).toEqual([
			expect.objectContaining({ entity: 'climate.v1', temperature: 5, reason: 'brain_trv_close' }),
			expect.objectContaining({ entity: ZONE, temperature: 17, reason: 'brain_zone_eco' })
		]);
	});

	it('closes the valve at once for an open window', () => {
		const memory = { ...emptyMemory(), sent: { 'climate.v1': { at: now - 60_000, temp: 23 } } };
		const result = decide(inputs(19, true), { bed: schedule() }, brain, states, ZONE, memory, now);
		const valve = result.send.find((item) => item.entity === 'climate.v1');
		expect(valve).toMatchObject({ temperature: 5, urgent: true, reason: 'brain_trv_window' });
	});

	it('follows a manual change until it runs out', () => {
		const memory = { ...emptyMemory(), overrides: { bed: { temp: 23, until: now + 3_600_000 } } };
		const plan = decide(inputs(22), { bed: schedule() }, brain, states, ZONE, memory, now).plans[0];
		expect(plan).toMatchObject({ target: 23, source: 'override', calling: true });
		const expired = { ...emptyMemory(), overrides: { bed: { temp: 23, until: now - 1 } } };
		expect(
			decide(inputs(22), { bed: schedule() }, brain, states, ZONE, expired, now).plans[0].target
		).toBe(21);
	});

	it('never aims below frost protection', () => {
		const plan = decide(inputs(6), { bed: schedule(5, 5) }, brain, states, ZONE, emptyMemory(), now)
			.plans[0];
		expect(plan).toMatchObject({ target: 7, calling: true });
	});

	it('keeps the last answer when the room has no reading', () => {
		const memory = { ...emptyMemory(), calling: { bed: true } };
		const plan = decide(inputs(undefined), { bed: schedule() }, brain, states, ZONE, memory, now)
			.plans[0];
		expect(plan).toMatchObject({ calling: true, reason: 'brain_no_reading' });
	});

	it('keeps the boiler running for another room when the thermostat room is warm', () => {
		const living = room('living', [], ['sensor.zone_indoor']);
		const result = decide(
			[
				{ room: living, reading: reading('living', 22.6), zone: ZONE },
				{ room: room('bed', ['climate.v1']), reading: reading('bed', 19) }
			],
			{ living: schedule(22), bed: schedule(21) },
			brain,
			states,
			ZONE,
			emptyMemory(),
			now
		);
		expect(result.wanted.find((item) => item.entity === ZONE)?.temperature).toBe(23);
	});

	it('sets the zone to its own room, not to a warmer target elsewhere', () => {
		const living = room('living', [], ['sensor.zone_indoor']);
		const memory = { ...emptyMemory(), overrides: { bed: { temp: 23, until: now + 3_600_000 } } };
		const result = decide(
			[
				{ room: living, reading: reading('living', 21.4), zone: ZONE },
				{ room: room('bed', ['climate.v1']), reading: reading('bed', 20.8) }
			],
			{ living: schedule(22), bed: schedule(21) },
			brain,
			states,
			ZONE,
			memory,
			now
		);
		expect(result.wanted.find((item) => item.entity === ZONE)?.temperature).toBe(22);
		expect(result.wanted.find((item) => item.entity === 'climate.v1')?.temperature).toBe(25);
	});

	it('says "close to the target" inside the hysteresis', () => {
		const plan = decide(inputs(20.8), { bed: schedule() }, brain, states, ZONE, emptyMemory(), now)
			.plans[0];
		expect(plan.reason).toBe('brain_near');
	});

	it('does not touch the zone while its own room has no schedule', () => {
		const living = room('living', [], ['sensor.zone_indoor']);
		const result = decide(
			[
				{ room: living, reading: reading('living', 22), zone: ZONE },
				{ room: room('bed', ['climate.v1']), reading: reading('bed', 19) }
			],
			{ bed: schedule() },
			brain,
			states,
			ZONE,
			emptyMemory(),
			now
		);
		expect(result.wanted.map((item) => item.entity)).toEqual(['climate.v1']);
	});
});

describe('toSend', () => {
	const item = {
		entity: 'climate.v1',
		kind: 'trv' as const,
		temperature: 23,
		urgent: false,
		reason: 'brain_trv_open' as const,
		vars: {}
	};
	const states = { 'climate.v1': trv('climate.v1', 5) };

	it('sends only a real change, and not twice within the gap', () => {
		expect(toSend([item], states, emptyMemory(), brain, now)).toHaveLength(1);
		const same = { 'climate.v1': trv('climate.v1', 23) };
		expect(toSend([item], same, emptyMemory(), brain, now)).toHaveLength(0);
		const recent = { ...emptyMemory(), sent: { 'climate.v1': { at: now - 5 * 60_000, temp: 5 } } };
		expect(toSend([item], states, recent, brain, now)).toHaveLength(0);
		const older = { ...emptyMemory(), sent: { 'climate.v1': { at: now - 20 * 60_000, temp: 5 } } };
		expect(toSend([item], states, older, brain, now)).toHaveLength(1);
	});

	it('in the trial mode compares with what it would have sent', () => {
		const trial = { ...brain, dryRun: true };
		const would = { ...emptyMemory(), sent: { 'climate.v1': { at: now - 3_600_000, temp: 23 } } };
		expect(toSend([item], states, would, trial, now)).toHaveLength(0);
	});
});
