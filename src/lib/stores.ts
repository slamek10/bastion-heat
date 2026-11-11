import { derived, get, writable } from 'svelte/store';
import { translate, type Key } from '$lib/i18n';
import { roomReading, houseTemperature, zoneFor } from '$lib/rooms';
import {
	DEFAULT_SETTINGS,
	type Alert,
	type BrainStatus,
	type HaState,
	type LiveMessage,
	type Settings,
	type Status
} from '$lib/types';

export type Tab = 'overview' | 'curve' | 'analysis';

export const settings = writable<Settings>({ ...DEFAULT_SETTINGS });
export const states = writable<Record<string, HaState>>({});
export const status = writable<Status>({ ha: false });
export const tab = writable<Tab>('overview');
export const showDrawer = writable(false);
/** Uredi in the drawer: names of rooms and sensors become editable */
export const editMode = writable(false);
/** the brain: each room's plan and the latest decisions */
export const brain = writable<BrainStatus | undefined>();
/** airing advice and cold warnings, from the server */
export const alerts = writable<Alert[]>([]);
/** a clock that moves every 30 s, so readings age on the page */
export const now = writable(Date.now());

export const t = derived(
	settings,
	($settings) => (key: Key, vars?: Record<string, string>) => translate($settings.locale, key, vars)
);

/** every room as it is now */
export const rooms = derived([settings, states, now], ([$settings, $states, $now]) =>
	$settings.rooms.map((room) => ({
		room,
		reading: roomReading(
			room,
			$states,
			$now,
			$settings.staleMinutes,
			zoneFor(room, $settings.entities),
			$states[$settings.entities.zone]
		)
	}))
);
export const house = derived(rooms, ($rooms) =>
	houseTemperature($rooms.map((entry) => entry.reading))
);

export interface Toast {
	id: number;
	title: string;
	message: string;
	alert?: boolean;
}
export const toasts = writable<Toast[]>([]);
let toastId = 0;
export function toast(entry: Omit<Toast, 'id'>) {
	const id = ++toastId;
	toasts.update((list) => [{ ...entry, id }, ...list].slice(0, 4));
	setTimeout(() => toasts.update((list) => list.filter((item) => item.id !== id)), 7000);
}

export async function saveSettings(patch: Partial<Settings>) {
	const next = { ...get(settings), ...patch };
	settings.set(next);
	const response = await fetch('/_api/settings', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(next)
	});
	if (!response.ok) {
		toast({ title: get(t)('save_failed'), message: String(response.status), alert: true });
		throw new Error(String(response.status));
	}
	settings.set(await response.json());
}

/** a climate or water heater change, through the server (which checks it is one of ours) */
export async function call(domain: string, service: string, data: Record<string, unknown>) {
	const response = await fetch('/_api/ha/call', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, service, data })
	}).catch(() => undefined);
	if (!response?.ok) {
		const body = await response?.json().catch(() => undefined);
		toast({
			title: get(t)('call_failed'),
			message: body?.error ?? String(response?.status ?? ''),
			alert: true
		});
		return false;
	}
	return true;
}

/** hold a room at a temperature until its schedule next changes; null = back to the schedule */
export async function override(room: string, temp: number | null) {
	const response = await fetch('/_api/brain/override', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ room, temp })
	}).catch(() => undefined);
	if (!response?.ok) {
		toast({ title: get(t)('call_failed'), message: String(response?.status ?? ''), alert: true });
		return;
	}
	brain.set(await response.json());
}

function onMessage(message: LiveMessage) {
	if (message.kind === 'status') status.set(message.status);
	else if (message.kind === 'alerts') alerts.set(message.alerts);
	else if (message.kind === 'brain') brain.set(message.brain);
	else if (message.kind === 'states') states.update((all) => ({ ...all, ...message.states }));
	else if (message.kind === 'notice')
		toast({ title: message.title, message: message.message, alert: message.alert });
}

export function connectStream() {
	const source = new EventSource('/_api/stream');
	source.onmessage = (event) => {
		try {
			const message = JSON.parse(event.data);
			if (message.kind !== 'ping') onMessage(message);
		} catch {
			/* ignore */
		}
	};
	const clock = setInterval(() => now.set(Date.now()), 30_000);
	return () => {
		source.close();
		clearInterval(clock);
	};
}

/** a question in the app's own dialog instead of the browser's confirm() */
export interface Question {
	title: string;
	message: string;
	confirm: string;
	danger?: boolean;
	answer: (yes: boolean) => void;
}
export const question = writable<Question | undefined>();
export function ask(options: Omit<Question, 'answer'>) {
	return new Promise<boolean>((resolve) =>
		question.set({ ...options, answer: (yes) => (question.set(undefined), resolve(yes)) })
	);
}
