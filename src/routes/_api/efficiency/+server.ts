import { json } from '@sveltejs/kit';
import { efficiency } from '$lib/server/efficiency';

export async function GET() {
	try {
		return json(await efficiency());
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 502 });
	}
}
