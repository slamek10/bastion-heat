import { error, json } from '@sveltejs/kit';
import { loadTheme } from '$lib/server/themes';

export async function GET({ url }) {
	const theme = await loadTheme(url.searchParams.get('name') ?? '');
	if (!theme) error(404, 'no such theme');
	return json(theme);
}
