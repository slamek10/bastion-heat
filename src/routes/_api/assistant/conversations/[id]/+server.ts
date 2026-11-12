import { error, json } from '@sveltejs/kit';
import { deleteConversation, loadConversation } from '$lib/server/ai/conversations';

/** what the page shows; the API history stays on the server */
export async function GET({ params }) {
	const conversation = await loadConversation(params.id);
	if (!conversation) error(404, 'no such conversation');
	const { messages: _messages, ...view } = conversation;
	return json(view);
}

export async function DELETE({ params }) {
	await deleteConversation(params.id);
	return json({ ok: true });
}
