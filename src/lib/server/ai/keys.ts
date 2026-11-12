/**
 * The Claude API key: sealed with HEAT_SECRET in data/ai.json, or
 * ANTHROPIC_API_KEY from the environment. The browser can set or clear it,
 * never read it back.
 */
import { read, write } from '$lib/server/store';
import { open, seal } from '$lib/server/secrets';

const FILE = 'ai.json';

async function saved() {
	try {
		return open((await read<{ sealed?: string }>(FILE, {})).sealed).token ?? '';
	} catch {
		return '';
	}
}

export async function apiKey() {
	return (await saved()) || process.env.ANTHROPIC_API_KEY?.trim() || '';
}

export async function setApiKey(key: string) {
	const clean = key.trim();
	await write(FILE, clean ? { sealed: seal({ token: clean }) } : {}, { private: true });
}

export async function keyStatus() {
	const own = await saved();
	const env = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
	const key = own || env;
	return {
		configured: !!key,
		source: own ? ('saved' as const) : env ? ('env' as const) : null,
		last4: key ? key.slice(-4) : null
	};
}
