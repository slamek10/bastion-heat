import { hasSession, missingConfig } from '../../auth.js';
import { loadTheme } from '$lib/server/themes';
import { loadSettings } from '$lib/server/store';
import { watchedStates } from '$lib/server/ha';
import { refreshWatched } from '$lib/server/heat';

export async function load({ request }) {
	const settings = await loadSettings();
	const theme = (await loadTheme(settings.theme)) ?? (await loadTheme('adaptive-ember'));
	const missing = missingConfig();
	if (missing.length || !hasSession(request.headers.get('cookie'))) {
		return { needsLogin: true, missing, settings, theme, states: {} };
	}
	await refreshWatched();
	return { needsLogin: false, missing, settings, theme, states: watchedStates() };
}
