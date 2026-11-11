<script lang="ts">
	import { house, settings, showDrawer, status, t } from '$lib/stores';
	import { rememberBack } from '$lib/back';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	let { onMenu }: { onMenu: () => void } = $props();

	let now = $state(new Date());
	onMount(() => {
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(tick);
	});

	let locale = $derived($settings.locale === 'hr' ? 'hr-HR' : 'en-GB');
	let time = $derived(now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
	let date = $derived(
		now.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: '2-digit' })
	);

	/** where Natrag goes: Bastion HA, when the app was opened from there */
	let back = $state<string | undefined>();
	onMount(() => {
		back = rememberBack();
	});
</script>

<header>
	{#if back}
		<a class="round big back" href={back} title={$t('back')} aria-label={$t('back')}>
			<Icon icon="mdi:arrow-left" height="1.5rem" />
		</a>
	{/if}
	<!-- same clock as bastion-ha's overview -->
	<div class="clock">
		<div class="date">{date}</div>
		<div class="time">{time}</div>
	</div>

	<div class="right">
		<div class="pill" class:bad={!$status.ha} title="Home Assistant">
			{#if $house !== undefined}<span>{$house}°C</span>{/if}
			<span class="dot" class:on={$status.ha}></span>HA
		</div>

		<button class="round big" onclick={onMenu} title={$t('menu')} aria-label={$t('menu')}>
			<span class="chevron" style:transform="rotate({$showDrawer ? 180 : 0}deg)">
				<Icon icon="mdi:chevron-down" height="1.6rem" />
			</span>
		</button>
	</div>
</header>

<style>
	header {
		display: flex;
		justify-content: flex-start;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		padding: calc(2rem + env(safe-area-inset-top)) 2rem 1rem;
		min-width: 0;
		color: white;
	}

	.back {
		color: inherit;
		text-decoration: none;
		flex-shrink: 0;
	}

	.date {
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-size: 0.95rem;
		font-weight: 500;
		opacity: 0.75;
	}

	.time {
		font-size: clamp(3rem, 7vw, 4.4rem);
		font-weight: 300;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	.right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	button {
		font-family: inherit;
		color: inherit;
		cursor: pointer;
	}

	.round {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(12px);
	}

	.round.big {
		width: 3.3rem;
		height: 3.3rem;
	}

	.round:hover {
		background: rgba(255, 255, 255, 0.18);
	}

	.chevron {
		display: flex;
		transition: transform 300ms ease;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.75rem 1.1rem;
		border-radius: 2rem;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(12px);
		font-size: 0.9rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.pill.bad {
		border-color: rgba(249, 38, 38, 0.6);
	}

	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #8a8a8a;
		margin-left: 0.35rem;
	}

	.dot:first-child {
		margin-left: 0;
	}

	.dot.on {
		background: #22c55e;
	}

	@media (max-width: 768px) {
		header {
			padding: calc(1.2rem + env(safe-area-inset-top)) 1rem 0.8rem;
		}
	}

	@media (max-width: 560px) {
		.pill {
			font-size: 0;
			gap: 0.3rem;
			padding: 0.75rem 0.9rem;
		}
	}
</style>
