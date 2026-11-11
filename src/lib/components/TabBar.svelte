<script lang="ts">
	import { rooms, tab, t, type Tab } from '$lib/stores';
	import type { Key } from '$lib/i18n';
	import Icon from '@iconify/svelte';

	const tabs: { id: Tab; icon: string; key: Key }[] = [
		{ id: 'overview', icon: 'mdi:radiator', key: 'tab_overview' },
		{ id: 'curve', icon: 'mdi:chart-bell-curve-cumulative', key: 'tab_curve' },
		{ id: 'rooms', icon: 'mdi:home-thermometer-outline', key: 'tab_rooms' },
		{ id: 'analysis', icon: 'mdi:chart-box-outline', key: 'tab_analysis' }
	];
</script>

<nav class="tabbar">
	{#each tabs as item (item.id)}
		<button class:active={$tab === item.id} onclick={() => ($tab = item.id)}>
			<span class="icon">
				<Icon icon={item.icon} height="1.35rem" />
				{#if item.id === 'rooms' && $rooms.some((entry) => entry.reading.windowOpen)}
					<span class="badge">!</span>
				{/if}
			</span>
			<span>{$t(item.key)}</span>
		</button>
	{/each}
</nav>

<style>
	/* bastion-ha's overview tab bar */
	.tabbar {
		position: fixed;
		left: 50%;
		bottom: calc(1.2rem + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 3;
		display: flex;
		gap: 0.25rem;
		padding: 0.4rem;
		border-radius: 2.2rem;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: var(--home-bar);
		backdrop-filter: blur(18px);
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
	}

	button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.7rem 1.3rem;
		border: none;
		border-radius: 1.8rem;
		background: none;
		color: rgba(255, 255, 255, 0.75);
		font-family: inherit;
		font-size: 1.05rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color 0.2s ease,
			color 0.2s ease;
	}

	button:hover {
		color: white;
	}

	button.active {
		background: var(--home-card-on);
		color: #2a1a24;
	}

	.icon {
		position: relative;
		display: flex;
	}

	.badge {
		position: absolute;
		top: -0.45rem;
		right: -0.7rem;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.25rem;
		border-radius: 1rem;
		background: var(--home-accent-color);
		color: #3b2400;
		font-size: 0.68rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	@media (max-width: 560px) {
		button {
			flex-direction: column;
			gap: 0.15rem;
			padding: 0.45rem 0.8rem;
			border-radius: 1.4rem;
			font-size: 0.72rem;
		}
	}
</style>
