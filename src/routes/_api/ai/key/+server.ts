import { json } from '@sveltejs/kit';
import { keyStatus, setApiKey } from '$lib/server/ai/keys';

export const GET = async () => json(await keyStatus());

/** set or (empty) remove the saved key; it is never sent back */
export async function PUT({ request }) {
	const { key } = await request.json().catch(() => ({}));
	if (typeof key !== 'string' || key.length > 500)
		return json({ error: 'invalid' }, { status: 400 });
	await setApiKey(key);
	return json(await keyStatus());
}
