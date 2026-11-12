import { error, json } from '@sveltejs/kit';
import { decide } from '$lib/server/ai/proposals';

/** Potvrdi (confirm: true) or Odbij (false) on a card in the chat */
export async function POST({ params, request }) {
	const body = await request.json().catch(() => ({}));
	if (typeof body.confirm !== 'boolean') return json({ error: 'invalid' }, { status: 400 });
	const proposal = await decide(params.id, body.confirm);
	if (!proposal) error(404, 'no such proposal');
	return json(proposal, { status: proposal.status === 'failed' ? 502 : 200 });
}
