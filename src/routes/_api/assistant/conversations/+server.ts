import { json } from '@sveltejs/kit';
import { listConversations } from '$lib/server/ai/conversations';

export const GET = async () => json(await listConversations());
