import { json } from '@sveltejs/kit';
import { keyFor } from '$lib/server/ai/mcp';

/** a reading key to this app's tools for Bastion HA's house assistant (bastion-ai's token) */
export function POST({ request }) {
	const key = keyFor(request.headers.get('authorization'));
	if (!key) return new Response('Unauthorized', { status: 401 });
	return json({ key, expires: Date.now() + 10 * 60_000 });
}
