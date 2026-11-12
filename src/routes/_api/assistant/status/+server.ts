import { json } from '@sveltejs/kit';
import { gateway, gatewayStatus, lastLimits } from '$lib/server/ai/gateway';
import { keyStatus } from '$lib/server/ai/keys';

/** how the assistant reaches Claude: the subscription (bastion-ai), an API key, or not at all */
export async function GET() {
	const sub = await gatewayStatus();
	const key = await keyStatus();
	return json({
		engine: gateway() ? 'subscription' : key.configured ? 'api' : null,
		gateway: sub,
		limits: lastLimits(),
		key
	});
}
