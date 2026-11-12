import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	checkPassword,
	hasSession,
	loginCookie,
	logoutCookies,
	sessionValue
} from '../../../auth.js';

const ENV = {
	APP_PASSWORD: 'pass',
	HEAT_SECRET: 'h'.repeat(40),
	HASS_URL: 'http://ha',
	HASS_TOKEN: 't'
};

describe('login', () => {
	beforeEach(() => Object.assign(process.env, ENV));
	afterEach(() => {
		for (const key of [...Object.keys(ENV), 'BASTION_SESSION_SECRET']) delete process.env[key];
	});

	it("without the shared login: this app's own cookie", () => {
		expect(checkPassword('pass')).toBe(true);
		const cookie = loginCookie();
		expect(cookie.name).toBe('bastion_heat_session');
		expect(hasSession(`${cookie.name}=${cookie.value}`)).toBe(true);
	});

	it('with the shared login: only the shared cookie counts', () => {
		process.env.BASTION_SESSION_SECRET = 's'.repeat(40);
		const cookie = loginCookie();
		expect(cookie.name).toBe('bastion_session');
		expect(hasSession(`bastion_session=${cookie.value}`)).toBe(true);
		// an older own cookie no longer keeps the app open
		expect(hasSession(`bastion_heat_session=${sessionValue()}`)).toBe(false);
		expect(logoutCookies()).toEqual(['bastion_heat_session', 'bastion_session']);
	});
});
