import { json } from '@sveltejs/kit';
import { isPulling, loadVaillant, pullNow, type VaillantStore } from '$lib/server/vaillant';

function status(store: VaillantStore) {
	const dates = Object.keys(store.days).sort();
	return {
		days: dates.length,
		from: dates[0],
		to: dates.at(-1),
		firstData: store.firstData,
		fetchedAt: store.fetchedAt,
		error: store.error,
		/** history still being pulled in the background */
		filling: isPulling() || (!!store.firstData && !!store.backTo && store.backTo > store.firstData)
	};
}

export const GET = async () => json(status(await loadVaillant()));

/** the last week now, the rest in the background; not while a pull runs */
export async function POST() {
	if (isPulling()) return json({ ...status(await loadVaillant()), busy: true });
	return json(status(await pullNow()));
}
