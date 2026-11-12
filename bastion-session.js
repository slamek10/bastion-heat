/**
 * One login for the Bastion apps on one server (Bastion HA, Cams, Heat,
 * Watch): a cookie every app accepts, signed with BASTION_SESSION_SECRET
 * (the same in every app's .env). Browsers send a host's cookies to every
 * port, so signing in to one app signs in to all of them, and signing out
 * of one signs out of all of them.
 *
 * The same file is in every Bastion app; change it in all of them.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const SHARED_COOKIE = 'bastion_session';
/** seconds */
export const SHARED_MAX_AGE = 30 * 24 * 3600;

const secret = () => process.env.BASTION_SESSION_SECRET || '';

/** the shared login is on when the secret is set (32+ characters) */
export const sharedEnabled = () => secret().length >= 32;

const key = () => Buffer.from(hkdfSync('sha256', secret(), 'bastion', 'shared-session', 32));
const sign = (body) => createHmac('sha256', key()).update(body).digest('hex');

/** a cookie value: v1.<expires, unix seconds>.<signature> */
export function createShared(now = Date.now()) {
	const body = `v1.${Math.floor(now / 1000) + SHARED_MAX_AGE}`;
	return `${body}.${sign(body)}`;
}

export function validShared(value, now = Date.now()) {
	if (!sharedEnabled() || typeof value !== 'string') return false;
	const match = value.match(/^(v1\.(\d{1,12}))\.([0-9a-f]{64})$/);
	if (!match || Number(match[2]) * 1000 <= now) return false;
	const given = Buffer.from(match[3]);
	const wanted = Buffer.from(sign(match[1]));
	return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** the shared cookie's value from a Cookie header */
export function sharedFromHeader(header) {
	const match = (header ?? '').match(new RegExp(`(?:^|;\\s*)${SHARED_COOKIE}=([^;]+)`));
	return match ? decodeURIComponent(match[1]) : undefined;
}
