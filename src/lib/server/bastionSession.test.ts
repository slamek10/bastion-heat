import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createShared,
	sharedEnabled,
	sharedFromHeader,
	validShared
} from '../../../bastion-session.js';

const SECRET = 'x'.repeat(40);

describe('shared Bastion login', () => {
	beforeEach(() => {
		process.env.BASTION_SESSION_SECRET = SECRET;
	});
	afterEach(() => {
		delete process.env.BASTION_SESSION_SECRET;
	});

	it('accepts its own cookie until it expires', () => {
		const now = Date.parse('2026-11-12T12:00:00Z');
		const value = createShared(now);
		expect(validShared(value, now)).toBe(true);
		expect(validShared(value, now + 29 * 86_400_000)).toBe(true);
		expect(validShared(value, now + 31 * 86_400_000)).toBe(false);
	});

	it('refuses a changed one, another secret, or none', () => {
		const value = createShared();
		const [v, exp, sig] = value.split('.');
		expect(validShared(`${v}.${Number(exp) + 999999}.${sig}`)).toBe(false);
		expect(validShared(`${value.slice(0, -1)}${value.endsWith('0') ? '1' : '0'}`)).toBe(false);
		expect(validShared('garbage')).toBe(false);
		expect(validShared(undefined)).toBe(false);
		process.env.BASTION_SESSION_SECRET = 'y'.repeat(40);
		expect(validShared(value)).toBe(false);
	});

	it('is off without a long enough secret', () => {
		const value = createShared();
		process.env.BASTION_SESSION_SECRET = 'short';
		expect(sharedEnabled()).toBe(false);
		expect(validShared(value)).toBe(false);
	});

	it('reads the cookie among others', () => {
		expect(sharedFromHeader('a=1; bastion_session=v1.2.abc; b=2')).toBe('v1.2.abc');
		expect(sharedFromHeader('a=1')).toBeUndefined();
		expect(sharedFromHeader(undefined)).toBeUndefined();
	});
});
