<script lang="ts">
	/** one part of a device in Sustav: a card with an icon, a title, buttons on the right */
	import Icon from '@iconify/svelte';
	import type { Snippet } from 'svelte';

	let {
		icon,
		title,
		wide = false,
		head,
		children
	}: { icon?: string; title: string; wide?: boolean; head?: Snippet; children: Snippet } = $props();
</script>

<section class="w-card panel" class:wide>
	<h3>
		{#if icon}<Icon {icon} height="1.15rem" />{/if}
		<span>{title}</span>
		{#if head}<span class="extra">{@render head()}</span>{/if}
	</h3>
	{@render children()}
</section>

<style>
	.panel {
		min-width: 0;
	}

	.wide {
		grid-column: 1 / -1;
	}

	.extra {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 400;
	}
</style>
