import { describe, expect, it } from 'vitest';
import { bytes, serviceName } from './format';

describe('format', () => {
	it('bytes', () => {
		expect(bytes(0)).toBe('0 B');
		expect(bytes(999)).toBe('999 B');
		expect(bytes(1500)).toBe('1.50 kB');
		expect(bytes(12_300_000)).toBe('12.3 MB');
		expect(bytes(4.2e12)).toBe('4.20 TB');
	});

	it('services', () => {
		expect(serviceName(6, 443)).toBe('HTTPS (TCP 443)');
		expect(serviceName(17, 40000)).toBe('UDP 40000');
		expect(serviceName(1, 0)).toBe('ICMP');
	});
});
