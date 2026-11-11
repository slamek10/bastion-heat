<script lang="ts">
	import { rooms, settings } from '$lib/stores';
	import {
		activityLevel,
		adaptiveBaseCss,
		adaptiveCss,
		adaptiveStops,
		colorsAt
	} from '$lib/adaptive';

	let { theme = $bindable() }: { theme: any } = $props();

	// a different theme picked in Postavke loads here
	$effect(() => {
		const name = $settings.theme;
		if (!name || theme?.title === name) return;
		fetch(`/_api/theme?name=${encodeURIComponent(name)}`)
			.then((response) => (response.ok ? response.json() : undefined))
			.then((loaded) => loaded && (theme = loaded))
			.catch(() => {});
	});

	let stops = $derived(adaptiveStops(theme?.adaptive));
	// warmer with every room that is heating
	let level = $derived(activityLevel($rooms.filter((entry) => entry.reading.heating).length));
	let colors = $derived(stops && colorsAt(stops, level));

	let css = $derived(
		Object.entries<unknown>(theme?.theme ?? {})
			.map(([key, value]) => `--theme-${key}: ${value};`)
			.join(' ') +
			` --home-accent-color: var(--theme-home-accent, #ffc93c); --home-card-on: var(--theme-home-card-on, #f3ead6); --home-bar: var(--theme-home-bar, rgba(40, 22, 36, 0.55));`
	);
</script>

<svelte:head>
	{@html `<style>:root {${css}}</style>`}
	{#if colors}
		{@html `<style>${adaptiveBaseCss(true)} ${adaptiveCss(colors, level)}</style>`}
	{/if}
	<meta name="theme-color" content={theme?.theme?.['app-color']} />
</svelte:head>
