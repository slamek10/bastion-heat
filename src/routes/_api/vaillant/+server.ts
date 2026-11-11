import { json } from '@sveltejs/kit';
import { loadVaillant, refreshVaillant } from '$lib/server/vaillant';

export async function GET() {
	const store = await loadVaillant();
	const dates = Object.keys(store.days).sort();
	return json({
		days: dates.length,
		from: dates[0],
		to: dates.at(-1),
		firstData: store.firstData,
		fetchedAt: store.fetchedAt,
		error: store.error
	});
}

let last = 0;

/** pull now (the last week, then the missing history in the background); once in 5 minutes */
export async function POST() {
	if (Date.now() - last < 5 * 60_000) return json({ error: 'wait' }, { status: 429 });
	last = Date.now();
	refreshVaillant().catch(() => {});
	return json({ ok: true });
}
