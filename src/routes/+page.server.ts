import { hasSession, missingConfig } from '../../auth.js';
import { loadTheme } from '$lib/server/themes';
import { loadSettings } from '$lib/server/store';
import { currentAlerts } from '$lib/server/checks';
import { watchedStates } from '$lib/server/ha';
import { refreshWatched } from '$lib/server/heat';
import { brainStatus } from '$lib/server/brain';

export async function load({ request }) {
	const settings = await loadSettings();
	const theme = (await loadTheme(settings.theme)) ?? (await loadTheme('adaptive-ember'));
	const missing = missingConfig();
	if (missing.length || !hasSession(request.headers.get('cookie'))) {
		return {
			needsLogin: true,
			missing,
			settings,
			theme,
			states: {},
			alerts: [],
			brain: undefined
		};
	}
	await refreshWatched();
	return {
		needsLogin: false,
		missing,
		settings,
		theme,
		states: watchedStates(),
		alerts: currentAlerts(),
		brain: await brainStatus()
	};
}
