import { describe, expect, it } from 'vitest';
import { open, seal } from './secrets';

const SECRET = 'a'.repeat(64);

describe('secrets', () => {
	it('opens what it sealed', () => {
		const sealed = seal({ password: 'hunter2', token: 'abc' }, SECRET);
		expect(open(sealed, SECRET)).toEqual({ password: 'hunter2', token: 'abc' });
	});

	it('never stores the plain text', () => {
		const sealed = seal({ password: 'hunter2-very-visible' }, SECRET);
		expect(sealed).not.toContain('hunter2');
		expect(Buffer.from(sealed.split('.')[3], 'base64').toString()).not.toContain('hunter2');
	});

	it('uses a fresh IV every time', () => {
		expect(seal({ password: 'x' }, SECRET)).not.toBe(seal({ password: 'x' }, SECRET));
	});

	it('refuses another key', () => {
		const sealed = seal({ password: 'x' }, SECRET);
		expect(() => open(sealed, 'b'.repeat(64))).toThrow();
	});

	it('refuses a changed value', () => {
		const parts = seal({ password: 'x' }, SECRET).split('.');
		const body = Buffer.from(parts[3], 'base64');
		body[0] ^= 1;
		parts[3] = body.toString('base64');
		expect(() => open(parts.join('.'), SECRET)).toThrow();
	});

	it('refuses a short HEAT_SECRET', () => {
		expect(() => seal({ password: 'x' }, 'short')).toThrow(/32/);
	});

	it('nothing sealed is no secrets', () => {
		expect(open(undefined, SECRET)).toEqual({});
	});
});
