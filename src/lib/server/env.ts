import { env } from '$env/dynamic/private';

export const config = {
	get hassUrl() {
		return (env.HASS_URL || '').replace(/\/$/, '');
	},
	get hassToken() {
		return env.HASS_TOKEN || '';
	},
	get publicUrl() {
		return (env.APP_URL || '').replace(/\/$/, '');
	},
	get dataDir() {
		// process.env first: tests set it after SvelteKit read its env (in production they're the same)
		return process.env.DATA_DIR || env.DATA_DIR || './data';
	}
};
