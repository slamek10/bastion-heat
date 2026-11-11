<script lang="ts">
	/** the app's own yes / no dialog (see ask() in stores) */
	import { question, t } from '$lib/stores';
	import Icon from '@iconify/svelte';
	import { fade, scale } from 'svelte/transition';

	let yes = $state<HTMLButtonElement>();
	$effect(() => {
		if ($question) yes?.focus();
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (!$question) return;
		if (e.key === 'Escape') $question.answer(false);
	}}
/>

{#if $question}
	{@const q = $question}
	<div
		class="backdrop"
		onclick={() => q.answer(false)}
		role="presentation"
		transition:fade={{ duration: 120 }}
	></div>
	<div
		class="dialog"
		role="alertdialog"
		aria-label={q.title}
		transition:scale={{ duration: 150, start: 0.96 }}
	>
		<div class="icon" class:danger={q.danger}>
			<Icon icon={q.danger ? 'mdi:trash-can-outline' : 'mdi:help-circle-outline'} height="1.6rem" />
		</div>
		<h2>{q.title}</h2>
		<p>{q.message}</p>
		<div class="buttons">
			<button class="pill" onclick={() => q.answer(false)}>{$t('cancel')}</button>
			<button
				bind:this={yes}
				class="pill primary"
				class:danger={q.danger}
				onclick={() => q.answer(true)}
			>
				{q.confirm}
			</button>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 30000;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
	}

	.dialog {
		position: fixed;
		z-index: 30001;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		width: min(24rem, calc(100vw - 2rem));
		padding: 1.4rem 1.4rem 1.2rem;
		border-radius: 1.4rem;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(25, 18, 32, 0.95);
		backdrop-filter: blur(20px);
		box-shadow: 0 1.5rem 3rem rgba(0, 0, 0, 0.5);
		color: white;
		text-align: center;
	}

	.icon {
		display: inline-flex;
		padding: 0.7rem;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
	}

	.icon.danger {
		background: rgba(249, 38, 38, 0.2);
		color: #ff8a8a;
	}

	h2 {
		margin: 0.8rem 0 0.4rem;
		font-size: 1.15rem;
		font-weight: 600;
	}

	p {
		margin: 0 0 1.3rem;
		opacity: 0.8;
		line-height: 1.45;
	}

	.buttons {
		display: flex;
		gap: 0.6rem;
	}

	.pill {
		flex: 1;
		padding: 0.7rem 1rem;
		border-radius: 2rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.1);
		color: inherit;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}

	.pill.primary {
		background: var(--home-card-on);
		color: #2a1a24;
	}

	.pill.danger {
		background: #e0312f;
		border-color: #e0312f;
		color: white;
	}
</style>
