/**
 * The way back to Bastion HA (or wherever the app was opened from):
 * ?from=<address> on the link, kept for the visit in sessionStorage, shown
 * as a button top left. Only http(s) addresses, so a link can't carry a
 * javascript: or data: target into the button.
 */
export const BACK_KEY = 'bastion-back';

export function parseBack(search: string): string | undefined {
	const raw = new URLSearchParams(search).get('from');
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/** read ?from= once, remember it, and take it out of the address bar */
export function rememberBack(): string | undefined {
	const found = parseBack(location.search);
	try {
		if (found) sessionStorage.setItem(BACK_KEY, found);
		const kept = sessionStorage.getItem(BACK_KEY) ?? undefined;
		if (found) {
			const url = new URL(location.href);
			url.searchParams.delete('from');
			history.replaceState(null, '', url.pathname + url.search + url.hash);
		}
		return kept ? parseBack(`?from=${encodeURIComponent(kept)}`) : undefined;
	} catch {
		return found;
	}
}
