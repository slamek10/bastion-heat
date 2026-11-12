import { mcpRequest } from '$lib/server/ai/mcp';

/** Heat's tools for Claude Code (through bastion-ai); a key made for one turn only */
export const POST = ({ request }) => mcpRequest(request);

/** no server-sent stream: answers come back on the POST */
export const GET = () =>
	new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
export const DELETE = () => new Response(null, { status: 204 });
