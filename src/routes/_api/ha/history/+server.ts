import { json } from '@sveltejs/kit';
import { history } from '$lib/server/ha';
import { loadSettings } from '$lib/server/store';
import { entitiesOf } from '$lib/server/heat';

/** temperatures over the last hours, for entities of the heating settings only */
export async function GET({ url }) {
	const settings = await loadSettings();
	const known = entitiesOf(settings);
	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.filter((id) => known.has(id))
		.slice(0, 40);
	const hours = Math.min(240, Math.max(1, Number(url.searchParams.get('hours')) || 24));
	if (!ids.length) return json({});
	try {
		return json(await history(ids, new Date(Date.now() - hours * 3_600_000)));
	} catch (error) {
		return json({ error: (error as Error).message.slice(0, 200) }, { status: 502 });
	}
}
