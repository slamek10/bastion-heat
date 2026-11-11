/**
 * Buttons on phone notifications. A button carries an action id with a
 * random token; the token maps (in memory, for 6 hours) to exactly what was
 * offered, so a press can only do what Heat itself put on that
 * notification. HA delivers the press as mobile_app_notification_action on
 * its websocket.
 */
import { randomUUID } from 'node:crypto';
import { config } from '$lib/server/env';

const PREFIX = 'BHEAT_';
const TTL = 6 * 3_600_000;

export type Offer =
	| { kind: 'confirm'; pendingId: string }
	| { kind: 'reject'; pendingId: string }
	| { kind: 'mute'; key: string }
	| { kind: 'boost'; roomId: string; minutes: number };

const global = globalThis as unknown as {
	__heatOffers?: Map<string, Offer & { at: number }>;
	__heatPhoneListener?: boolean;
};
const offers = (global.__heatOffers ??= new Map());

/** a button for this offer: its action id for the notification */
export function offer(what: Offer) {
	const now = Date.now();
	for (const [token, entry] of offers) if (now - entry.at > TTL) offers.delete(token);
	const token = randomUUID().replace(/-/g, '');
	offers.set(token, { ...what, at: now });
	return `${PREFIX}${token}`;
}

/** what a pressed action id stands for, once; undefined when unknown or expired */
export function take(action: string) {
	if (!action.startsWith(PREFIX)) return undefined;
	const token = action.slice(PREFIX.length);
	const entry = offers.get(token);
	if (!entry) return undefined;
	offers.delete(token);
	if (Date.now() - entry.at > TTL) return undefined;
	return entry as Offer;
}

/** what runs a press; set once by the app (actions live there, this module only matches buttons) */
let handler: ((what: Offer) => Promise<void>) | undefined;
export function onPhoneAction(run: (what: Offer) => Promise<void>) {
	handler = run;
}

async function handle(action: string) {
	const what = take(action);
	if (!what || !handler) return;
	try {
		await handler(what);
	} catch (error) {
		console.warn('[phone]', (error as Error).message);
	}
}

/** listens for mobile_app_notification_action; reconnects by itself (as in Bastion Cams) */
export function startPhoneActions() {
	if (
		global.__heatPhoneListener ||
		!config.hassUrl ||
		!config.hassToken ||
		typeof WebSocket === 'undefined'
	)
		return;
	global.__heatPhoneListener = true;
	let delay = 5000;
	const connect = () => {
		let socket: WebSocket;
		try {
			socket = new WebSocket(`${config.hassUrl.replace(/^http/, 'ws')}/api/websocket`);
		} catch {
			setTimeout(connect, delay);
			return;
		}
		socket.onmessage = (event) => {
			let message: any;
			try {
				message = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (message.type === 'auth_required') {
				socket.send(JSON.stringify({ type: 'auth', access_token: config.hassToken }));
			} else if (message.type === 'auth_ok') {
				delay = 5000;
				socket.send(
					JSON.stringify({
						id: 1,
						type: 'subscribe_events',
						event_type: 'mobile_app_notification_action'
					})
				);
			} else if (message.type === 'event') {
				const action = String(message.event?.data?.action ?? '');
				if (action.startsWith(PREFIX)) handle(action);
			}
		};
		socket.onclose = () => {
			setTimeout(connect, delay);
			delay = Math.min(delay * 2, 120_000);
		};
		socket.onerror = () => {};
	};
	connect();
}
