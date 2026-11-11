import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],
	kit: {
		adapter: adapter()
	},
	// touch-first like bastion-ha, keyboard a11y warnings are noise here
	onwarn(warning, defaultHandler) {
		if (warning.code.startsWith('a11y')) return;
		defaultHandler(warning);
	},
	vitePlugin: {
		dynamicCompileOptions({ filename }) {
			if (!filename.includes('node_modules')) return { runes: true };
		}
	}
};

export default config;
