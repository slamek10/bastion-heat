/**
 * Home Assistant over its websocket API, on the server only: every state
 * kept current (get_states, then state_changed), service calls and
 * history. The page gets the entities the heating uses through the app's
 * own SSE stream and never sees the token.
 */
import { setStatus, publish } from '$lib/server/bus';
import type { HaState } from '$lib/types';

const url = () => (process.env.HASS_URL || '').replace(/\/$/, '');
const token = () => process.env.HASS_TOKEN || '';

interface State {
	started: boolean;
	socket?: WebSocket;
	ready: boolean;
	states: Map<string, HaState>;
	nextId: number;
	pending: Map<
		number,
		{
			resolve: (value: any) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>;
	/** entities the page shows; changes to them are published */
	watched: Set<string>;
	changed: Map<string, HaState>;
	flush?: ReturnType<typeof setTimeout>;
	delay: number;
}

const global = globalThis as unknown as { __heatHa?: State };
const state: State = (global.__heatHa ??= {
	started: false,
	ready: false,
	states: new Map(),
	nextId: 1,
	pending: new Map(),
	watched: new Set(),
	changed: new Map(),
	delay: 2000
});

function send(message: Record<string, unknown>, timeout = 30_000): Promise<any> {
	const socket = state.socket;
	if (!socket || !state.ready || socket.readyState !== WebSocket.OPEN) {
		return Promise.reject(new Error('Home Assistant is not connected'));
	}
	const id = state.nextId++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			state.pending.delete(id);
			reject(new Error('Home Assistant did not answer'));
		}, timeout);
		state.pending.set(id, { resolve, reject, timer });
		socket.send(JSON.stringify({ id, ...message }));
	});
}

function queuePublish(entity: HaState) {
	if (!state.watched.has(entity.entity_id)) return;
	state.changed.set(entity.entity_id, entity);
	// a burst of changes goes out as one message
	state.flush ??= setTimeout(() => {
		state.flush = undefined;
		const states = Object.fromEntries(state.changed);
		state.changed.clear();
		publish({ kind: 'states', states });
	}, 400);
}

function connect() {
	if (!url() || !token()) return;
	let socket: WebSocket;
	try {
		socket = new WebSocket(`${url().replace(/^http/, 'ws')}/api/websocket`);
	} catch {
		setTimeout(connect, state.delay);
		return;
	}
	state.socket = socket;
	socket.onmessage = async (event) => {
		let message: any;
		try {
			message = JSON.parse(String(event.data));
		} catch {
			return;
		}
		if (message.type === 'auth_required') {
			socket.send(JSON.stringify({ type: 'auth', access_token: token() }));
		} else if (message.type === 'auth_invalid') {
			console.warn('[ha] the token was refused');
			socket.close();
		} else if (message.type === 'auth_ok') {
			state.ready = true;
			state.delay = 2000;
			try {
				const list: HaState[] = await send({ type: 'get_states' });
				state.states = new Map(list.map((entity) => [entity.entity_id, entity]));
				await send({ type: 'subscribe_events', event_type: 'state_changed' });
				setStatus({ ha: true });
				publish({ kind: 'states', states: watchedStates() });
			} catch (error) {
				console.warn('[ha]', (error as Error).message);
			}
		} else if (message.type === 'result') {
			const waiting = state.pending.get(message.id);
			if (!waiting) return;
			state.pending.delete(message.id);
			clearTimeout(waiting.timer);
			if (message.success) waiting.resolve(message.result);
			else waiting.reject(new Error(message.error?.message ?? 'Home Assistant refused'));
		} else if (message.type === 'event' && message.event?.event_type === 'state_changed') {
			const next: HaState | null = message.event.data?.new_state;
			const id: string = message.event.data?.entity_id;
			if (next) {
				state.states.set(id, next);
				queuePublish(next);
			} else state.states.delete(id);
		}
	};
	socket.onclose = () => {
		state.ready = false;
		setStatus({ ha: false });
		for (const [id, waiting] of state.pending) {
			clearTimeout(waiting.timer);
			waiting.reject(new Error('Home Assistant disconnected'));
			state.pending.delete(id);
		}
		setTimeout(connect, state.delay);
		state.delay = Math.min(state.delay * 2, 60_000);
	};
	socket.onerror = () => {};
}

export function startHa() {
	if (state.started || typeof WebSocket === 'undefined') return;
	state.started = true;
	connect();
}

export const haReady = () => state.ready;
export const getState = (id: string) => state.states.get(id);
export const allStates = () => [...state.states.values()];

export function setWatched(ids: Iterable<string>) {
	state.watched = new Set([...ids].filter(Boolean));
}

export function watchedStates(): Record<string, HaState> {
	const out: Record<string, HaState> = {};
	for (const id of state.watched) {
		const entity = state.states.get(id);
		if (entity) out[id] = entity;
	}
	return out;
}

export function callService(domain: string, service: string, data: Record<string, unknown>) {
	return send({ type: 'call_service', domain, service, service_data: data });
}

/** an action that answers with data (supports_response), e.g. mypyllant.export */
export async function callForResponse(
	domain: string,
	service: string,
	data: Record<string, unknown>,
	timeout = 120_000
) {
	const result = await send(
		{ type: 'call_service', domain, service, service_data: data, return_response: true },
		timeout
	);
	return result?.response as unknown;
}

export function getServices(): Promise<Record<string, Record<string, unknown>>> {
	return send({ type: 'get_services' });
}

/** state history; climate entities with attributes (current_temperature), sensors without */
export function history(entityIds: string[], start: Date, end = new Date()) {
	return send(
		{
			type: 'history/history_during_period',
			start_time: start.toISOString(),
			end_time: end.toISOString(),
			entity_ids: entityIds,
			minimal_response: true,
			no_attributes: !entityIds.some((id) => id.startsWith('climate.')),
			significant_changes_only: false
		},
		60_000
	) as Promise<Record<string, { s: string; a?: Record<string, any>; lu?: number; lc?: number }[]>>;
}

/** long-term statistics (kept forever, unlike history): daily or hourly mean/min/max or change */
export function statistics(
	ids: string[],
	start: Date,
	period: 'hour' | 'day' | 'week' | 'month',
	types: ('mean' | 'min' | 'max' | 'change')[],
	end = new Date()
) {
	return send(
		{
			type: 'recorder/statistics_during_period',
			start_time: start.toISOString(),
			end_time: end.toISOString(),
			statistic_ids: ids,
			period,
			types,
			units: { energy: 'kWh', temperature: '°C' }
		},
		120_000
	) as Promise<Record<string, import('$lib/efficiency').StatRow[]>>;
}

/** writes a state HA shows like any sensor (POST /api/states), e.g. Heat's summary for Bastion HA */
export async function setHaState(
	entityId: string,
	value: string,
	attributes: Record<string, unknown>
) {
	const response = await fetch(`${url()}/api/states/${entityId}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ state: value, attributes }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`HA ${response.status}`);
}

export interface RegistryEntry {
	entity_id: string;
	device_id?: string | null;
	platform: string;
	unique_id?: string;
}

const registry = globalThis as unknown as {
	__heatRegistry?: { at: number; list: RegistryEntry[] };
};

/** HA's entity registry (which device and integration each entity belongs to), kept an hour */
export async function entityRegistry(): Promise<RegistryEntry[]> {
	const cached = registry.__heatRegistry;
	if (cached && Date.now() - cached.at < 3_600_000) return cached.list;
	try {
		const list = ((await send({ type: 'config/entity_registry/list' })) as RegistryEntry[]).map(
			({ entity_id, device_id, platform, unique_id }) => ({
				entity_id,
				device_id,
				platform,
				unique_id
			})
		);
		registry.__heatRegistry = { at: Date.now(), list };
		return list;
	} catch {
		return cached?.list ?? [];
	}
}
