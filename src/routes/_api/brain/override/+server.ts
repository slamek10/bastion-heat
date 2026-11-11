import { json } from '@sveltejs/kit';
import { brainStatus, setOverride } from '$lib/server/brain';

/** a room held at a temperature until its schedule next changes; temp null = back to the schedule */
export async function POST({ request }) {
	const body = await request.json().catch(() => ({}));
	const room = typeof body?.room === 'string' ? body.room : '';
	const raw = body?.temp;
	const temp = raw === null ? null : Number(raw);
	if (temp !== null && (!Number.isFinite(temp) || temp < 5 || temp > 30))
		return json({ error: 'temperature' }, { status: 400 });
	const ok = await setOverride(room, temp === null ? null : Math.round(temp * 10) / 10);
	if (!ok) return json({ error: 'room' }, { status: 404 });
	return json(await brainStatus());
}
