<script lang="ts">
	import { editMode, t, tab } from '$lib/stores';
	import Icon from '@iconify/svelte';
	import { slide } from 'svelte/transition';

	let { onSettings }: { onSettings: () => void } = $props();

	async function logout() {
		await fetch('/_api/logout', { method: 'POST' });
		location.reload();
	}
</script>

<!-- bastion-ha's drawer: actions on the left, Postavke on the right next to the menu button -->
<header id="drawer" transition:slide={{ duration: 300 }}>
	<div class="grid">
		<button
			class="button"
			class:active={$editMode}
			onclick={() => {
				$editMode = !$editMode;
				// rooms live in Pregled
				if ($editMode) $tab = 'overview';
			}}
		>
			<Icon icon={$editMode ? 'mdi:check' : 'mdi:pencil-outline'} height="1.25rem" />
			<span>{$editMode ? $t('done') : $t('edit')}</span>
		</button>

		<button class="button" onclick={logout}>
			<Icon icon="mdi:logout" height="1.25rem" />
			<span>{$t('logout')}</span>
		</button>

		<button class="button settings" onclick={onSettings}>
			<Icon icon="mdi:cog-outline" height="1.25rem" />
			<span>{$t('settings')}</span>
		</button>
	</div>
</header>

<style>
	#drawer {
		width: 100%;
		padding: 1rem 2rem;
		background-color: var(--theme-colors-sidebar-background);
		border-bottom: var(--theme-colors-sidebar-border);
		color: white;
	}

	.grid {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.button {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		border: none;
		border-radius: 0.4rem;
		padding: 0.6rem 1rem;
		font-family: inherit;
		font-weight: 500;
		font-size: var(--theme-drawer-font-size, 0.925rem);
		background-color: var(--theme-drawer-button-background-color, rgba(255, 255, 255, 0.1));
		color: inherit;
		text-decoration: none;
		cursor: pointer;
		white-space: nowrap;
	}

	.button.active {
		background: var(--home-card-on);
		color: #2a1a24;
	}

	/* pushed right, ends where the header's menu button is */
	.settings {
		margin-left: auto;
	}

	@media (max-width: 768px) {
		#drawer {
			padding: 1rem 1.25rem;
		}

		.button {
			padding: 0.6rem 0.8rem;
		}

		.button span {
			display: none;
		}

		.settings span {
			display: inline;
		}
	}
</style>
