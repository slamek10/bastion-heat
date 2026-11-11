/**
 * Everything kept on disk, as JSON files in data/ like the other Bastion apps
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '$lib/server/env';
import { DEFAULT_SETTINGS, type Settings } from '$lib/types';

export async function read<T>(file: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await readFile(join(config.dataDir, file), 'utf8')) as T;
	} catch {
		return fallback;
	}
}

/** through a temp file, a crash mid-write never leaves half a file; private = only this user reads it */
export async function write(file: string, value: unknown, { private: own = false } = {}) {
	await mkdir(config.dataDir, { recursive: true });
	const path = join(config.dataDir, file);
	const mode = own ? 0o600 : 0o644;
	await writeFile(`${path}.tmp`, JSON.stringify(value, null, '\t') + '\n', { mode });
	await chmod(`${path}.tmp`, mode);
	await rename(`${path}.tmp`, path);
}

export async function loadSettings(): Promise<Settings> {
	const saved = await read<Partial<Settings>>('settings.json', {});
	return {
		...DEFAULT_SETTINGS,
		...saved,
		entities: { ...DEFAULT_SETTINGS.entities, ...saved.entities },
		report: { ...DEFAULT_SETTINGS.report, ...saved.report }
	};
}
export const saveSettings = (settings: Settings) => write('settings.json', settings);
