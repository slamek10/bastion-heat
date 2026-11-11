import { json } from '@sveltejs/kit';
import { COOKIE } from '../../../../auth.js';

export function POST({ cookies }) {
	cookies.delete(COOKIE, { path: '/' });
	return json({ ok: true });
}
