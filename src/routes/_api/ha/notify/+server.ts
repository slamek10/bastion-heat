import { json } from '@sveltejs/kit';
import { notifyServices } from '$lib/server/notify';

export const GET = async () => json(await notifyServices());
