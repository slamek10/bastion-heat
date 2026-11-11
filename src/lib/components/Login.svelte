<script lang="ts">
	import { t } from '$lib/stores';
	import Icon from '@iconify/svelte';

	let { missing = [] }: { missing?: string[] } = $props();

	let password = $state('');
	let locked = $state(false);
	let wrong = $state(false);
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		const response = await fetch('/_api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password })
		});
		busy = false;
		if (response.ok) location.reload();
		else {
			wrong = true;
			locked = response.status === 429;
		}
	}
</script>

<div class="center">
	<form class="card" onsubmit={submit}>
		<Icon icon="mdi:radiator" height="2.6rem" />
		<h1>{$t('app_name')}</h1>
		{#if missing.length}
			<p class="error">{$t('not_configured', { missing: missing.join(', ') })}</p>
		{:else}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="password"
				bind:value={password}
				placeholder={$t('password')}
				autofocus
				autocomplete="current-password"
			/>
			{#if wrong}<p class="error">{locked ? $t('login_locked') : $t('wrong_password')}</p>{/if}
			<button disabled={busy || !password}>{$t('login')}</button>
		{/if}
	</form>
</div>

<style>
	.center {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		color: white;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		width: min(22rem, 100%);
		padding: 2rem 1.6rem;
		border-radius: 1.4rem;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: linear-gradient(rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.05));
		backdrop-filter: blur(16px);
	}

	h1 {
		margin: 0 0 0.4rem;
		font-weight: 400;
	}

	input,
	button {
		width: 100%;
		padding: 0.8rem 1rem;
		border-radius: 2rem;
		font-family: inherit;
		font-size: 1rem;
	}

	input {
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(0, 0, 0, 0.2);
		color: white;
	}

	button {
		border: none;
		background: var(--home-card-on);
		color: #2a1a24;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
	}

	.error {
		margin: 0;
		color: #ff6b6b;
		text-align: center;
	}
</style>
