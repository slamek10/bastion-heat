/**
 * Vaillant's daily energy, through the myPyllant integration's
 * `mypyllant.export` action (no Vaillant password in Heat). Kept in
 * data/vaillant.json: the whole history once (in 60-day pieces, a minute
 * apart, back to the boiler's first data), then the last 7 days every
 * morning, since Vaillant fills a day in late. Vaillant limits API calls,
 * so this stays at a few calls a day.
 */
import { loadSettings, read, write } from '$lib/server/store';
import { callForResponse, haReady } from '$lib/server/ha';
import { dateKey } from '$lib/efficiency';
import { parseExport, type VaillantDay } from '$lib/vaillant';

export interface VaillantStore {
	days: Record<string, VaillantDay>;
	firstData?: string;
	/** the oldest day asked for so far; history is complete when it reaches firstData */
	backTo?: string;
	fetchedAt?: number;
	error?: string;
}

const FILE = 'vaillant.json';
const DAY = 86_400_000;
const CHUNK = 60;

export const loadVaillant = () => read<VaillantStore>(FILE, { days: {} });

const local = (date: string) => `${date}T00:00:00`;

async function fetchRange(from: Date, to: Date) {
	const response = await callForResponse('mypyllant', 'export', {
		data: true,
		resolution: 'DAY',
		start: local(dateKey(from)),
		end: local(dateKey(to))
	});
	return parseExport(response);
}

async function merge(from: Date, to: Date) {
	const store = await loadVaillant();
	try {
		const result = await fetchRange(from, to);
		Object.assign(store.days, result.days);
		store.firstData = result.firstData ?? store.firstData;
		const asked = dateKey(from);
		if (!store.backTo || asked < store.backTo) store.backTo = asked;
		store.fetchedAt = Date.now();
		delete store.error;
	} catch (error) {
		store.error = (error as Error).message;
	}
	await write(FILE, store);
	return store;
}

let pulling = false;
export const isPulling = () => pulling || filling;

/**
 * The last week now (awaited, so the page sees the result or the error),
 * then the missing history in the background.
 */
export async function pullNow(): Promise<VaillantStore> {
	if (!haReady()) {
		const store = await loadVaillant();
		store.error = 'Home Assistant is not connected';
		await write(FILE, store);
		return store;
	}
	pulling = true;
	try {
		const tomorrow = new Date();
		tomorrow.setHours(0, 0, 0, 0);
		tomorrow.setTime(tomorrow.getTime() + DAY);
		const store = await merge(new Date(tomorrow.getTime() - 8 * DAY), tomorrow);
		if (!store.error) backfill().catch(() => {});
		return store;
	} finally {
		pulling = false;
	}
}

export async function refreshVaillant() {
	const settings = await loadSettings();
	if (settings.energySource !== 'vaillant' || !haReady()) return;
	await pullNow();
}

let filling = false;
async function backfill(): Promise<void> {
	if (filling) return;
	filling = true;
	try {
		for (let i = 0; i < 20; i++) {
			const store = await loadVaillant();
			if (!store.backTo || !store.firstData || store.backTo <= store.firstData) return;
			const to = new Date(local(store.backTo));
			const from = new Date(to.getTime() - CHUNK * DAY);
			await new Promise((resolve) => setTimeout(resolve, 60_000));
			const after = await merge(from, to);
			if (after.error) return;
		}
	} finally {
		filling = false;
	}
}

const global = globalThis as unknown as { __heatVaillant?: boolean };

/** five minutes after start, then every morning at 05:30 */
export function startVaillant() {
	if (global.__heatVaillant || process.env.VAILLANT === 'off') return;
	global.__heatVaillant = true;
	const run = () => refreshVaillant().catch((error) => console.warn('[vaillant]', error.message));
	setTimeout(run, 5 * 60_000);
	setInterval(() => {
		const now = new Date();
		if (now.getHours() === 5 && now.getMinutes() === 30) run();
	}, 60_000).unref?.();
}
