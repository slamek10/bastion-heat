import { json } from '@sveltejs/kit';
import { config } from '$lib/server/env';
import { COOKIE, checkPassword, sessionValue } from '../../../../auth.js';

const WINDOW = 15 * 60_000;
const MAX_FAILS = 5;
/** failed logins per address: five in a quarter of an hour and that address waits */
const fails = new Map<string, number[]>();

export async function POST({ request, cookies, getClientAddress }) {
	const address = getClientAddress();
	const now = Date.now();
	const recent = (fails.get(address) ?? []).filter((time) => now - time < WINDOW);
	if (recent.length >= MAX_FAILS) {
		return json({ ok: false, locked: true }, { status: 429 });
	}
	const { password } = await request.json().catch(() => ({}));
	if (!checkPassword(password)) {
		fails.set(address, [...recent, now]);
		// slows down guessing
		await new Promise((resolve) => setTimeout(resolve, 800));
		return json({ ok: false }, { status: 401 });
	}
	fails.delete(address);
	cookies.set(COOKIE, sessionValue(), {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		// Secure only when the app is really served over https (APP_URL): adapter-node
		// reports https either way, and a Secure cookie on plain http is thrown away
		secure: config.publicUrl.startsWith('https:'),
		maxAge: 60 * 60 * 24 * 30
	});
	return json({ ok: true });
}
