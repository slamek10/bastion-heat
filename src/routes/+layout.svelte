<script lang="ts">
	import '@fontsource-variable/inter';
	import '$lib/ui.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<title>Bastion Heat</title>
</svelte:head>

{@render children()}

<style>
	/* bastion-ha's +layout.svelte */
	:global(body, html) {
		margin: 0;
		padding: 0;
		-webkit-tap-highlight-color: transparent;
		box-sizing: border-box;
	}

	:global(html) {
		color: var(--theme-colors-text, white);
		font-size: 100%;
	}

	:global(body) {
		background: black;
		font-family: var(--theme-font-family, 'Inter Variable', system-ui);
		user-select: none;
		-webkit-user-select: none;
		background-size: cover;
		background-repeat: no-repeat;
		background-attachment: fixed;
		min-height: 100dvh;
	}

	:global(*, *::before, *::after) {
		box-sizing: inherit;
	}

	:global(input, select) {
		user-select: text;
		-webkit-user-select: text;
	}
</style>
