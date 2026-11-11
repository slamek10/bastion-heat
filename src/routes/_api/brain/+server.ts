import { json } from '@sveltejs/kit';
import { brainStatus, decisions } from '$lib/server/brain';

/** the plans of the rooms and the decision log (?all=1: the last 500) */
export async function GET({ url }) {
	const status = await brainStatus();
	if (!url.searchParams.get('all')) return json(status);
	return json({ ...status, log: (await decisions()).slice(-500).reverse() });
}
