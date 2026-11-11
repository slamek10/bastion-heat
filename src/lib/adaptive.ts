/**
 * bastion-ha's adaptive themes (src/lib/Home/adaptive.ts), trimmed: here the
 * background warms up with the rooms that heat instead of lights
 */
export type AdaptiveColors = [string, string, string, string];

export interface AdaptiveStop {
	at: number;
	colors: AdaptiveColors;
}

const HEX = /^#[0-9a-f]{6}$/i;
const SLOTS = ['glow-a', 'glow-b', 'glow-c', 'base'];

export function adaptiveStops(value: unknown): AdaptiveStop[] | undefined {
	if (!Array.isArray(value) || value.length < 2) return undefined;
	const valid = value.every(
		(stop, index) =>
			typeof stop?.at === 'number' &&
			(index === 0 || stop.at > value[index - 1].at) &&
			Array.isArray(stop.colors) &&
			stop.colors.length === SLOTS.length &&
			stop.colors.every((color: unknown) => typeof color === 'string' && HEX.test(color))
	);
	return valid ? value : undefined;
}

function mix(from: string, to: string, amount: number) {
	const channel = (hex: string, start: number) => parseInt(hex.slice(start, start + 2), 16);
	return `#${[1, 3, 5]
		.map((start) => {
			const a = channel(from, start);
			return Math.round(a + (channel(to, start) - a) * amount)
				.toString(16)
				.padStart(2, '0');
		})
		.join('')}`;
}

export function colorsAt(stops: AdaptiveStop[], level: number) {
	const next = stops.findIndex((stop) => stop.at >= level);
	if (next <= 0) return next === 0 ? stops[0].colors : stops[stops.length - 1].colors;
	const [from, to] = [stops[next - 1], stops[next]];
	const amount = (level - from.at) / (to.at - from.at);
	return from.colors.map((color, index) => mix(color, to.colors[index], amount)) as AdaptiveColors;
}

/** each heating room adds a third, three fill it */
export const activityLevel = (heating: number) => Math.min(1, heating / 3);

export function adaptiveBaseCss(fade: boolean) {
	const names = SLOTS.map((slot) => `--adaptive-${slot}`);
	const registered = [
		...names.map(
			(name) => `@property ${name} { syntax: '<color>'; inherits: true; initial-value: #000; }`
		),
		`@property --adaptive-level { syntax: '<number>'; inherits: true; initial-value: 0; }`
	].join(' ');
	if (!fade) return registered;
	const faded = [...names, '--adaptive-level'].map((name) => `${name} 1.5s ease`).join(', ');
	return `${registered} :root { transition: ${faded}; }`;
}

export function adaptiveCss(colors: AdaptiveColors, level: number) {
	const base = mix(colors[3], colors[1], level * 0.5);
	const shown = [colors[0], colors[1], colors[2], base];
	const values = SLOTS.map((slot, index) => `--adaptive-${slot}: ${shown[index]};`).join(' ');
	const reach = (from: number, by: number) => `calc(${from}% + ${by}% * var(--adaptive-level))`;
	const image = [
		`radial-gradient(circle at 15% 10%, var(--adaptive-glow-a) 0, transparent ${reach(60, 45)})`,
		`radial-gradient(circle at 85% 90%, var(--adaptive-glow-b) 0, transparent ${reach(60, 45)})`,
		`radial-gradient(circle at 60% 50%, var(--adaptive-glow-c) 0, transparent ${reach(45, 40)})`,
		'linear-gradient(var(--adaptive-base), var(--adaptive-base))'
	].join(', ');
	return `:root:root { ${values} --adaptive-level: ${level}; --theme-background-image: ${image}; }`;
}
