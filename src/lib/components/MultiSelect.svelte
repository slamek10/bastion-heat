<script lang="ts">
	/**
	 * A dropdown of checkboxes: one line while closed, a list with search
	 * when open. The list is moved to <body>, because a parent with
	 * overflow or backdrop-filter would cut a fixed panel off.
	 */
	import { t } from '$lib/stores';
	import Icon from '@iconify/svelte';
	import { onMount, tick } from 'svelte';

	interface Item {
		value: string;
		label: string;
		icon?: string;
		hint?: string;
	}

	let {
		items,
		selected,
		onchange,
		ontoggle,
		placeholder,
		disabled = false,
		single = false,
		ariaLabel
	}: {
		items: Item[];
		selected: string[];
		onchange?: (next: string[]) => void;
		/** instead of onchange, when picking one thing changes others too */
		ontoggle?: (value: string) => void;
		/** shown with nothing ticked, e.g. "Sve kamere" */
		placeholder?: string;
		disabled?: boolean;
		/** pick one: ontoggle gets it and the list closes */
		single?: boolean;
		ariaLabel?: string;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let trigger = $state<HTMLButtonElement>();
	let panel = $state<HTMLDivElement>();
	let search = $state<HTMLInputElement>();
	let style = $state('');
	let pinned = $state<string[]>([]);

	const SEARCH_FROM = 8;
	const PANEL_HEIGHT = 340;

	let names = $derived(
		selected.map((value) => items.find((item) => item.value === value)?.label ?? value)
	);
	let summary = $derived(
		!names.length
			? (placeholder ?? $t('multi_none'))
			: single || names.length <= 2
				? names.join(', ')
				: $t('multi_selected', { count: String(names.length) })
	);

	// what was ticked when it opened stays on top, nothing jumps while ticking
	let shown = $derived.by(() => {
		const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const matching = items.filter((item) => {
			const text = `${item.label} ${item.hint ?? ''} ${item.value}`.toLowerCase();
			return words.every((word) => text.includes(word));
		});
		return [
			...matching.filter((item) => pinned.includes(item.value)),
			...matching.filter((item) => !pinned.includes(item.value))
		];
	});

	function place() {
		if (!trigger) return;
		const box = trigger.getBoundingClientRect();
		const width = Math.min(Math.max(box.width, 260), window.innerWidth - 16);
		const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
		const below = window.innerHeight - box.bottom - 12;
		const above = box.top - 12;
		const down = below >= Math.min(PANEL_HEIGHT, 220) || below >= above;
		const height = Math.min(PANEL_HEIGHT, down ? below : above);
		style = `left:${left}px;width:${width}px;max-height:${height}px;${
			down ? `top:${box.bottom + 4}px` : `bottom:${window.innerHeight - box.top + 4}px`
		}`;
	}

	async function show() {
		if (disabled) return;
		if (open) return close();
		pinned = [...selected];
		query = '';
		place();
		open = true;
		await tick();
		search?.focus();
	}

	function close() {
		open = false;
	}

	function toggle(value: string) {
		if (single) close();
		if (ontoggle) return ontoggle(value);
		onchange?.(
			selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]
		);
	}

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	onMount(() => {
		const outside = (event: Event) => {
			if (!open) return;
			const target = event.target as Node;
			if (!trigger?.contains(target) && !panel?.contains(target)) close();
		};
		// the list's own scrolling doesn't move it, the page's does
		const moved = (event: Event) => {
			if (open && !panel?.contains(event.target as Node)) place();
		};
		// Esc closes this list, not the settings behind it
		const key = (event: KeyboardEvent) => {
			if (open && event.key === 'Escape') {
				event.stopPropagation();
				close();
			}
		};
		window.addEventListener('pointerdown', outside, true);
		window.addEventListener('scroll', moved, true);
		window.addEventListener('resize', moved);
		window.addEventListener('keydown', key, true);
		return () => {
			window.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('scroll', moved, true);
			window.removeEventListener('resize', moved);
			window.removeEventListener('keydown', key, true);
		};
	});
</script>

<button
	type="button"
	class="trigger"
	class:open
	class:empty={!names.length}
	bind:this={trigger}
	onclick={show}
	{disabled}
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-label={ariaLabel}
	title={names.join(', ')}
>
	<span class="summary">{summary}</span>
	<Icon icon="mdi:chevron-down" height="1.2rem" />
</button>

{#if open}
	<div
		class="panel"
		bind:this={panel}
		use:portal
		{style}
		role="listbox"
		aria-multiselectable="true"
	>
		{#if items.length >= SEARCH_FROM}
			<label class="search">
				<Icon icon="mdi:magnify" height="1.1rem" />
				<input bind:this={search} bind:value={query} placeholder={$t('search')} />
			</label>
		{/if}
		<div class="list">
			{#each shown as item (item.value)}
				{@const on = selected.includes(item.value)}
				<button
					type="button"
					class="option"
					class:on
					role="option"
					aria-selected={on}
					onclick={() => toggle(item.value)}
				>
					{#if !single}
						<Icon
							icon={on ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'}
							height="1.25rem"
						/>
					{/if}
					{#if item.icon}<Icon icon={item.icon} height="1.1rem" />{/if}
					<span class="label">{item.label}</span>
					{#if item.hint}<span class="hint">{item.hint}</span>{/if}
				</button>
			{:else}
				<p class="nothing">{$t('multi_nothing')}</p>
			{/each}
		</div>
		{#if onchange && !single && items.length > 3}
			<div class="bulk">
				<button type="button" onclick={() => onchange?.(items.map((item) => item.value))}>
					{$t('multi_all')}
				</button>
				<button type="button" onclick={() => onchange?.([])}>{$t('multi_clear')}</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		max-width: 26rem;
		box-sizing: border-box;
		padding: 0.55rem 0.8rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(0, 0, 0, 0.2);
		color: white;
		font-family: inherit;
		font-size: 0.95rem;
		text-align: start;
		cursor: pointer;
	}

	.trigger.open {
		border-color: rgba(255, 255, 255, 0.45);
	}

	.trigger:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.summary {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.trigger.empty .summary {
		opacity: 0.65;
	}

	.panel {
		position: fixed;
		z-index: 40000;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		border-radius: 0.8rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgb(30 26 42);
		box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.55);
		color: white;
		font-size: 0.92rem;
		overflow: hidden;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.7rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		opacity: 0.9;
	}

	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: white;
		font-family: inherit;
		font-size: 0.92rem;
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.5rem 0.55rem;
		border: none;
		border-radius: 0.5rem;
		background: none;
		color: rgba(255, 255, 255, 0.85);
		font-family: inherit;
		font-size: inherit;
		text-align: start;
		cursor: pointer;
	}

	.option:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.option.on {
		color: white;
		font-weight: 500;
	}

	.label {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.hint {
		margin-left: auto;
		font-size: 0.78rem;
		opacity: 0.55;
		white-space: nowrap;
	}

	.nothing {
		margin: 0.6rem;
		opacity: 0.6;
	}

	.bulk {
		display: flex;
		justify-content: space-between;
		padding: 0.25rem 0.4rem;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.bulk button {
		padding: 0.35rem 0.5rem;
		border: none;
		border-radius: 0.4rem;
		background: none;
		color: rgba(255, 255, 255, 0.75);
		font-family: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.bulk button:hover {
		background: rgba(255, 255, 255, 0.08);
		color: white;
	}
</style>
