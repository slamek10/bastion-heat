import { describe, expect, it } from 'vitest';
import { parseBack } from './back';

describe('back link', () => {
	it('takes http and https', () => {
		expect(parseBack('?from=' + encodeURIComponent('http://192.168.10.12:5050/#heating'))).toBe(
			'http://192.168.10.12:5050/#heating'
		);
		expect(parseBack('?from=https%3A%2F%2Fha.example%2F')).toBe('https://ha.example/');
	});

	it('refuses anything else', () => {
		expect(parseBack('?from=javascript:alert(1)')).toBeUndefined();
		expect(parseBack('?from=data:text/html,x')).toBeUndefined();
		expect(parseBack('?from=not a url')).toBeUndefined();
		expect(parseBack('')).toBeUndefined();
	});
});
