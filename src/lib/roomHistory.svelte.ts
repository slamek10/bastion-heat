/**
 * 24 hours of every room sensor, fetched once for all the room cards in
 * Pregled (they can sit in different panels) and again every 10 minutes.
 */
import { get } from 'svelte/store';
import { settings } from '$lib/stores';

export type Point = { t: number; v: number };
export const roomHistory = $state<{ data: Record<string, Point[]> }>({ data: {} });

/** HA's minimal history rows: the first full, then s / a / lu */
function parse(
	id: string,
	rows: { s: string; a?: Record<string, any>; lu?: number; lc?: number }[]
): Point[] {
	const climate = id.startsWith('climate.');
	let attributes: Record<string, any> = {};
	const points: Point[] = [];
	for (const row of rows) {
		if (row.a) attributes = row.a;
		const seconds = row.lu ?? row.lc;
		if (typeof seconds !== 'number') continue;
		const v = parseFloat(climate ? attributes.current_temperature : row.s);
		if (Number.isFinite(v)) points.push({ t: seconds * 1000, v });
	}
	// a sensor that reports only on change: its last value holds until now
	const last = points.at(-1);
	if (last) points.push({ t: Date.now(), v: last.v });
	return points;
}

async function load() {
	const ids = [
		...new Set(
			get(settings).rooms.flatMap((room) => [
				...room.sensors,
				...(room.humidity ? [room.humidity] : [])
			])
		)
	];
	if (!ids.length) return;
	const response = await fetch(
		`/_api/ha/history?hours=24&ids=${encodeURIComponent(ids.join(','))}`
	).catch(() => undefined);
	if (!response?.ok) return;
	const body = await response.json();
	roomHistory.data = Object.fromEntries(
		Object.entries(body).map(([id, rows]) => [id, parse(id, rows as never)])
	);
}

/** for onMount: loads now and every 10 minutes, stops when the page goes */
export function followRoomHistory() {
	load();
	const timer = setInterval(load, 10 * 60_000);
	return () => clearInterval(timer);
}
