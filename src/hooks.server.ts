import type { Handle } from '@sveltejs/kit';
import { hasSession, missingConfig } from '../auth.js';
import { startHa } from '$lib/server/ha';
import { startSummary } from '$lib/server/heat';
import { startChecks } from '$lib/server/checks';
import { startReports } from '$lib/server/report';
import { startVaillant } from '$lib/server/vaillant';

if (!missingConfig().length) {
	startHa();
	startSummary();
	startChecks();
	startReports();
	startVaillant();
}

const OPEN = ['/_api/health', '/_api/login'];

function sameHost(origin: string, host: string | null) {
	try {
		return !!host && new URL(origin).host === host;
	} catch {
		return false;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (pathname.startsWith('/_api/') && !OPEN.includes(pathname)) {
		if (missingConfig().length) return new Response('Not configured', { status: 503 });
		if (!hasSession(event.request.headers.get('cookie'))) {
			return new Response('Unauthorized', { status: 401 });
		}
		// changes come only from this app's own pages; by host, adapter-node reports https either way
		const origin = event.request.headers.get('origin');
		if (
			event.request.method !== 'GET' &&
			origin &&
			!sameHost(origin, event.request.headers.get('host'))
		) {
			return new Response('Forbidden', { status: 403 });
		}
	}
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
