/**
 * A room's weekly schedule as it may be saved: from the settings page or a
 * change the assistant proposed, the same checks.
 */
import type { RoomSchedule } from '$lib/types';

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const range = (value: unknown, min: number, max: number, fallback: number) => {
	const number = Number(value);
	return Number.isFinite(number) && value !== '' && value !== null
		? Math.min(max, Math.max(min, number))
		: fallback;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const temp = (value: unknown, fallback: number) =>
	Math.round(range(value, 5, 30, fallback) * 10) / 10;

/** blocks with days, a start before the end and a temperature; at most 30 per room */
export function cleanSchedule(input: any): RoomSchedule | undefined {
	if (!input || typeof input !== 'object') return undefined;
	const blocks = (Array.isArray(input.blocks) ? input.blocks : [])
		.map((block: any) => ({
			days: [
				...new Set<number>(
					(Array.isArray(block?.days) ? block.days : [])
						.map(Number)
						.filter((day: number) => Number.isInteger(day) && day >= 1 && day <= 7)
				)
			].sort(),
			from: typeof block?.from === 'string' && TIME.test(block.from) ? block.from : '',
			to: typeof block?.to === 'string' && TIME.test(block.to) ? block.to : '',
			temp: temp(block?.temp, 20)
		}))
		.filter(
			(block: { days: number[]; from: string; to: string }) =>
				block.days.length && block.from && block.to && block.from < block.to
		)
		.slice(0, 30);
	return { enabled: flag(input.enabled, false), base: temp(input.base, 19), blocks };
}
