import { status, subscribe } from '$lib/server/bus';
import type { LiveMessage } from '$lib/types';

/** server-sent events: reviews, plates and connection changes as they happen */
export function GET({ request }) {
	let stop = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (message: LiveMessage | { kind: 'ping' }) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
				} catch {
					stop();
				}
			};
			send({ kind: 'status', status: { ...status } });
			const unsubscribe = subscribe(send);
			// keeps proxies from closing a quiet connection
			const ping = setInterval(() => send({ kind: 'ping' }), 25_000);
			stop = () => {
				clearInterval(ping);
				unsubscribe();
			};
			request.signal.addEventListener('abort', () => {
				stop();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel: () => stop()
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}
