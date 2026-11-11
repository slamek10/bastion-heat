<script lang="ts">
	import { toasts } from '$lib/stores';
	import Icon from '@iconify/svelte';
	import { fly } from 'svelte/transition';
</script>

<div class="toasts">
	{#each $toasts as item (item.id)}
		<button
			class="toast"
			class:alert={item.alert}
			transition:fly={{ y: -20, duration: 250 }}
			onclick={() => {
				$toasts = $toasts.filter((entry) => entry.id !== item.id);
			}}
		>
			<Icon icon={item.alert ? 'mdi:alert-circle-outline' : 'mdi:bell-outline'} height="1.4rem" />
			<span>
				<strong>{item.title}</strong>
				{#if item.message}<small>{item.message}</small>{/if}
			</span>
		</button>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		top: calc(1rem + env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		z-index: 30000;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: min(24rem, calc(100vw - 2rem));
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.8rem 1.1rem;
		border-radius: 1.2rem;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: var(--home-bar);
		backdrop-filter: blur(18px);
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
		color: white;
		font-family: inherit;
		text-align: left;
		pointer-events: auto;
		cursor: pointer;
	}

	.toast.alert {
		border-color: rgba(249, 38, 38, 0.7);
	}

	.toast span {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		text-transform: capitalize;
	}

	small {
		opacity: 0.8;
		font-size: 0.85rem;
	}
</style>
