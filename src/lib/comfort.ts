/**
 * Air and cold: when opening a window helps, and when a room or a spot is
 * cold enough to worry about. Pure, used by the server's checks and the page.
 */

/** water in the air, g/m³ (Magnus formula); 21 °C at 60 % ≈ 11 g/m³ */
export function absoluteHumidity(celsius: number, relative: number) {
	const saturation = 6.112 * Math.exp((17.67 * celsius) / (celsius + 243.5));
	return Math.round(((saturation * relative * 2.1674) / (273.15 + celsius)) * 10) / 10;
}

/** the temperature at which the room's air would condense on a surface */
export function dewPoint(celsius: number, relative: number) {
	const gamma = Math.log(Math.max(relative, 1) / 100) + (17.62 * celsius) / (243.12 + celsius);
	return Math.round(((243.12 * gamma) / (17.62 - gamma)) * 10) / 10;
}

export interface AirInput {
	temperature?: number;
	humidity?: number;
	co2?: number;
	windowOpen: boolean;
}

export interface Outdoor {
	temperature?: number;
	humidity?: number;
}

export interface AirLimits {
	/** % relative humidity above which airing is worth it */
	humidity: number;
	/** ppm */
	co2: number;
}

export interface Advice {
	reason: 'humidity' | 'co2';
	/** humidity: how many g/m³ drier the outdoor air is; co2: the ppm */
	value: number;
	dewPoint?: number;
}

/**
 * Air the room when it is too humid and the outdoor air holds clearly less
 * water (by g/m³, not by %, cold air at 90 % is still dry once warmed), or
 * when CO₂ is high. Not while a window is already open.
 */
export function airingAdvice(
	room: AirInput,
	outdoor: Outdoor,
	limits: AirLimits
): Advice | undefined {
	if (room.windowOpen) return undefined;
	if (room.co2 !== undefined && room.co2 >= limits.co2)
		return { reason: 'co2', value: Math.round(room.co2) };
	if (
		room.temperature === undefined ||
		room.humidity === undefined ||
		room.humidity < limits.humidity
	)
		return undefined;
	if (outdoor.temperature === undefined || outdoor.humidity === undefined) return undefined;
	const inside = absoluteHumidity(room.temperature, room.humidity);
	const outside = absoluteHumidity(outdoor.temperature, outdoor.humidity);
	const drier = Math.round((inside - outside) * 10) / 10;
	// at least 2 g/m³ drier outside, or airing just brings the moisture back
	if (drier < 2) return undefined;
	return { reason: 'humidity', value: drier, dewPoint: dewPoint(room.temperature, room.humidity) };
}

/** cold enough to worry: below the limit (pipes, mould, a heating fault) */
export const tooCold = (temperature: number | undefined, limit: number) =>
	temperature !== undefined && temperature < limit;

/** heating degree days for a day's mean outdoor temperature (base 18 °C, counted when the day is below 15 °C) */
export function degreeDays(meanOutdoor: number, base = 18, threshold = 15) {
	return meanOutdoor < threshold ? Math.round((base - meanOutdoor) * 10) / 10 : 0;
}

/** the heating season a day belongs to: July to June, named by its winter ("2025/26") */
export function seasonOf(date: Date) {
	const year = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
	return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}
