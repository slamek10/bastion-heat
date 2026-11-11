/**
 * bastion-ha's yaml themes, copied in by scripts/sync-shared.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

// dev serves static/, the node adapter build/client/
const DIRS = ['static/themes', 'build/client/themes', 'client/themes'];
const dir = () => DIRS.find((candidate) => existsSync(candidate)) ?? DIRS[0];

export async function listThemes() {
	try {
		return (await readdir(dir()))
			.filter((file) => file.endsWith('.yaml'))
			.map((file) => file.replace(/\.yaml$/, ''))
			.sort();
	} catch {
		return [];
	}
}

export async function loadTheme(name: string): Promise<Record<string, any> | undefined> {
	if (!/^[\w-]+$/.test(name)) return undefined;
	try {
		return load(await readFile(join(dir(), `${name}.yaml`), 'utf8')) as Record<string, any>;
	} catch {
		return undefined;
	}
}
