<script lang="ts">
	/** how full: a bar and the number; warn / bad thresholds add an edge in color and the number stays readable */
	let {
		value,
		warn = 80,
		bad = 90,
		label,
		onclick
	}: {
		value: number;
		warn?: number;
		bad?: number;
		label?: string;
		onclick?: () => void;
	} = $props();
	let clamped = $derived(Math.max(0, Math.min(100, Math.round(value))));
</script>

<svelte:element
	this={onclick ? 'button' : 'span'}
	class="w-meter"
	class:clickable={!!onclick}
	class:warn={clamped >= warn && clamped < bad}
	class:bad={clamped >= bad}
	{onclick}
	role={onclick ? 'button' : undefined}
	title={onclick ? 'history' : undefined}
>
	<span><span style:width="{clamped}%"></span></span>
	<span class:w-warn={clamped >= warn && clamped < bad} class:w-bad={clamped >= bad}>
		{label ?? `${clamped}%`}
	</span>
</svelte:element>

<style>
	.clickable {
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		padding: 0;
		cursor: pointer;
	}

	.clickable:hover > span:first-child {
		outline: 1px solid rgba(255, 255, 255, 0.35);
	}
</style>
