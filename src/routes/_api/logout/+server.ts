import { json } from '@sveltejs/kit';
import { config } from '$lib/server/env';
import { logoutCookies } from '../../../../auth.js';

/**
 * Signs out of this app, and with the shared Bastion login of all of them.
 * Secure as the login set it: a deletion marked Secure is ignored on plain
 * http, and the cookie would stay.
 */
export function POST({ cookies }) {
	const secure = config.publicUrl.startsWith('https:');
	for (const name of logoutCookies()) cookies.delete(name, { path: '/', secure });
	return json({ ok: true });
}
