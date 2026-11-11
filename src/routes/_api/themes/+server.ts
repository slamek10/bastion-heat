import { json } from '@sveltejs/kit';
import { listThemes } from '$lib/server/themes';

export const GET = async () => json(await listThemes());
