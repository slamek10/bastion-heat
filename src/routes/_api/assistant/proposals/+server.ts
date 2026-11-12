import { json } from '@sveltejs/kit';
import { listProposals } from '$lib/server/ai/proposals';

/** the latest proposals with their status, so a card shows whether it was answered */
export const GET = async () => json(await listProposals());
