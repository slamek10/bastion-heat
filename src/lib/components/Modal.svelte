<script lang="ts">
	import { t } from '$lib/stores';
	import Icon from '@iconify/svelte';
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';

	let {
		title,
		onclose,
		wide = false,
		children,
		actions
	}: {
		title: string;
		onclose: () => void;
		wide?: boolean;
		children: Snippet;
		actions?: Snippet;
	} = $props();

	/**
	 * Rendered straight into <body>: inside a card with backdrop-filter a fixed
	 * element is placed against the card, not the screen, and inherits its text
	 * styles (a heading made it all capitals)
	 */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="portal" use:portal>
	<div class="backdrop" onclick={onclose} transition:fade={{ duration: 150 }}></div>
	<div class="dialog" role="dialog" aria-label={title}>
		<div class="contents" class:wide transition:scale={{ duration: 180, start: 0.96 }}>
			<div class="header">
				<h1>{title}</h1>
				<div class="actions">
					{@render actions?.()}
					<button class="close" onclick={onclose} aria-label={$t('close')}>
						<Icon icon="mdi:close" height="1.4rem" />
					</button>
				</div>
			</div>
			<div class="body">{@render children()}</div>
		</div>
	</div>
</div>

<style>
	.portal {
		display: contents;
		font-family: var(--theme-font-family, 'Inter Variable', system-ui);
		text-transform: none;
		letter-spacing: normal;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20000;
		background: rgba(0, 0, 0, 0.35);
		backdrop-filter: blur(6px);
	}

	.dialog {
		position: fixed;
		inset: 0;
		z-index: 20001;
		display: flex;
		justify-content: center;
		align-items: center;
		pointer-events: none;
	}

	/* bastion-ha's modal */
	.contents {
		font-size: 0.95rem;
		padding: 1.3rem 1.5rem 1.5rem;
		/* the theme's tint over a dark base: what is behind must not show through the text */
		background:
			linear-gradient(rgb(12 14 24 / 72%), rgb(12 14 24 / 72%)),
			var(--theme-modal-background-color-modal, rgb(21 15 42 / 82%));
		backdrop-filter: blur(20px);
		display: flex;
		flex-direction: column;
		pointer-events: auto;
		width: min(34rem, 92vw);
		max-height: 88vh;
		border-radius: 1.2rem;
		box-shadow: rgba(0, 0, 0, 0.56) 0 22px 70px 4px;
		outline: 1px solid rgba(255, 255, 255, 0.25);
		overflow: hidden;
		color: white;
	}

	.contents.wide {
		width: min(72rem, 94vw);
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.9rem;
		flex-shrink: 0;
	}

	h1 {
		margin: 0;
		font-size: 1.3rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.close {
		display: flex;
		padding: 0.3rem;
		border: none;
		border-radius: 50%;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.close:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	@media (max-width: 560px) {
		.contents {
			width: 100vw;
			max-height: 100dvh;
			height: 100dvh;
			border-radius: 0;
			padding: calc(1rem + env(safe-area-inset-top)) 1rem 1rem;
		}

		.contents.wide {
			width: 100vw;
		}
	}
</style>
