import { json } from '@sveltejs/kit';
import { AssistantError, assistantTurn, type TurnEvent } from '$lib/server/ai/assistant';

/** one turn, streamed as server-sent events; the turn finishes even if the page goes away */
export async function POST({ request }) {
	const body = await request.json().catch(() => ({}));
	const message = typeof body.message === 'string' ? body.message.trim().slice(0, 8000) : '';
	const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;
	if (!message) return json({ error: 'empty' }, { status: 400 });

	let send: (event: TurnEvent) => void = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			let open = true;
			send = (event) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					open = false;
				}
			};
			assistantTurn(message, conversationId, send)
				.catch((error) =>
					send({
						type: 'error',
						message: error instanceof AssistantError ? error.message : 'failed'
					})
				)
				.finally(() => {
					if (open) controller.close();
					open = false;
				});
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'X-Accel-Buffering': 'no'
		}
	});
}
