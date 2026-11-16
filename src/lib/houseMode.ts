/**
 * The Bastion apps' shared house mode: an input_select in Home Assistant
 * (input_select.bastion_mode) with the options Doma, Odsutni, Noć and
 * Godišnji, set by hand (Bastion HA's Home, voice, the HA app) or to Noć by
 * the alarm's night mode. English option names work too.
 */
export type HouseMode = 'home' | 'away' | 'night' | 'vacation';

export const DEFAULT_MODE_ENTITY = 'input_select.bastion_mode';

const NAMES: Record<string, HouseMode> = {
	doma: 'home',
	home: 'home',
	odsutni: 'away',
	away: 'away',
	noc: 'night',
	night: 'night',
	godisnji: 'vacation',
	vacation: 'vacation',
	holiday: 'vacation'
};

/** the mode an option stands for; unknown, unavailable or missing is undefined */
export function houseMode(option: string | undefined): HouseMode | undefined {
	if (!option) return undefined;
	const key = option.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').trim().toLowerCase();
	return NAMES[key];
}
