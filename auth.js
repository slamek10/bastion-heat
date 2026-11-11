/**
 * Login, shared by server.js and SvelteKit's hooks. Unlike Bastion Cams there
 * is no open mode: this app holds admin credentials for the network, so it
 * needs APP_PASSWORD and HEAT_SECRET and refuses to work without them.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'bastion_heat_session';

const password = () => process.env.APP_PASSWORD || '';
const heatSecret = () => process.env.HEAT_SECRET || '';

/** what's missing for the app to run, empty when it can */
export function missingConfig() {
	const missing = [];
	if (!password()) missing.push('APP_PASSWORD');
	if (heatSecret().length < 32) missing.push('HEAT_SECRET (32+ characters)');
	if (!process.env.HASS_URL || !process.env.HASS_TOKEN) missing.push('HASS_URL and HASS_TOKEN');
	return missing;
}

/** its own key, so the cookie key and the credentials key never coincide */
const sessionKey = () =>
	Buffer.from(hkdfSync('sha256', heatSecret(), 'bastion-heat', 'session', 32));

const hmac = (value) => createHmac('sha256', sessionKey()).update(value).digest('hex');

export const authEnabled = () => true;

function same(a, b) {
	const x = Buffer.from(String(a));
	const y = Buffer.from(String(b));
	return x.length === y.length && timingSafeEqual(x, y);
}

export const checkPassword = (value) =>
	missingConfig().length === 0 && same(value ?? '', password());

// changes with the password, so changing it logs everyone out
export const sessionValue = () => hmac(`session:${password()}`);

export function cookieValue(header) {
	const match = (header ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
	return match ? decodeURIComponent(match[1]) : undefined;
}

export const hasSession = (cookieHeader) =>
	missingConfig().length === 0 && same(cookieValue(cookieHeader) ?? '', sessionValue());
