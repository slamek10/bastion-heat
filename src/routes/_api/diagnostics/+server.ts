import { json } from '@sveltejs/kit';
import { diagnostics } from '$lib/server/health';

/** the valves, the Imou API calls and a week of heating per room */
export async function GET() {
	try {
		return json(await diagnostics());
	} catch (error) {
		return json({ error: (error as Error).message.slice(0, 200) }, { status: 502 });
	}
}
