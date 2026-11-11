/**
 * Copies bastion-ha's themes into this app so both look the same. Run after a
 * theme changes there; the copies are committed so this repo builds on its own.
 *
 *   npm run sync                      bastion-ha cloned next to this repo
 *   npm run sync -- /path/to/bastion-ha
 *   BASTION_HA_DIR=/path npm run sync
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bastionHa = resolve(
	process.argv[2] ||
		process.env.BASTION_HA_DIR ||
		[join(here, '..', '..', 'bastion-ha'), join(here, '..', '..', 'ha-fusion')].find(existsSync) ||
		join(here, '..', '..', 'bastion-ha')
);
const from = join(bastionHa, 'static', 'themes');
const to = join(here, '..', 'static', 'themes');

if (!existsSync(from)) {
	console.error(
		`bastion-ha themes not found at ${from}; pass the bastion-ha folder as an argument`
	);
	process.exit(1);
}
mkdirSync(to, { recursive: true });
let count = 0;
for (const file of readdirSync(from)) {
	// yaml themes and their backgrounds, thumbnails aren't used here
	if (file.endsWith('.yaml') || file.endsWith('_background.webp')) {
		cpSync(join(from, file), join(to, file));
		count++;
	}
}
console.log(`synced ${count} theme files from ${bastionHa}`);
