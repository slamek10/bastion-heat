import { json } from '@sveltejs/kit';
import { currentAlerts } from '$lib/server/checks';

export const GET = () => json(currentAlerts());
