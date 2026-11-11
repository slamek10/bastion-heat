/**
 * Live messages for the open pages (server-sent events)
 */
import type { LiveMessage, Status } from '$lib/types';

type Listener = (message: LiveMessage) => void;
const listeners = new Set<Listener>();

export const status: Status = { ha: false };

export function publish(message: LiveMessage) {
	for (const listener of listeners) listener(message);
}

export function setStatus(patch: Partial<Status>) {
	const changed = Object.entries(patch).some(
		([key, value]) => status[key as keyof Status] !== value
	);
	Object.assign(status, patch);
	if (changed) publish({ kind: 'status', status: { ...status } });
}

export function subscribe(listener: Listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
