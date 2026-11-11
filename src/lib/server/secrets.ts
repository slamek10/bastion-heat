/**
 * Device credentials at rest: AES-256-GCM with a key derived from
 * HEAT_SECRET. A file copied off the server is useless without it, and a
 * changed or truncated value fails to open instead of decrypting to garbage.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
/** what is sealed: a few named secrets (the Claude key later) */
export type Secrets = Record<string, string>;

const VERSION = 'v1';
let cached: { secret: string; key: Buffer } | undefined;

function key(secret = process.env.HEAT_SECRET || '') {
	if (secret.length < 32) throw new Error('HEAT_SECRET must be at least 32 characters');
	if (cached?.secret !== secret) {
		cached = { secret, key: scryptSync(secret, 'bastion-heat:devices', 32) };
	}
	return cached.key;
}

export function seal(secrets: Secrets, secret?: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
	const body = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
	const parts = [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64'));
	return [VERSION, ...parts].join('.');
}

export function open(sealed: string | undefined, secret?: string): Secrets {
	if (!sealed) return {};
	const [version, iv, tag, body] = sealed.split('.');
	if (version !== VERSION || !iv || !tag || !body) {
		throw new Error('unknown credentials format');
	}
	const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'));
	decipher.setAuthTag(Buffer.from(tag, 'base64'));
	const text = Buffer.concat([
		decipher.update(Buffer.from(body, 'base64')),
		decipher.final()
	]).toString('utf8');
	return JSON.parse(text) as Secrets;
}
