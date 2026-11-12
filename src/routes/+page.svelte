<script lang="ts">
	import { onMount } from 'svelte';
	import {
		alerts,
		brain,
		connectStream,
		editMode,
		settings,
		showDrawer,
		states,
		tab
	} from '$lib/stores';
	import Theme from '$lib/components/Theme.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import Login from '$lib/components/Login.svelte';
	import Ask from '$lib/components/Ask.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import Overview from '$lib/tabs/Overview.svelte';
	import Curve from '$lib/tabs/Curve.svelte';
	import Analysis from '$lib/tabs/Analysis.svelte';
	import Assistant from '$lib/tabs/Assistant.svelte';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let theme = $state(data.theme);
	// svelte-ignore state_referenced_locally
	settings.set(data.settings);
	// svelte-ignore state_referenced_locally
	states.set(data.states);
	// svelte-ignore state_referenced_locally
	alerts.set(data.alerts);
	// svelte-ignore state_referenced_locally
	brain.set(data.brain);

	let openSettings = $state(false);

	onMount(() => {
		if (data.needsLogin) return;
		return connectStream();
	});

	// editing belongs to the rooms in Pregled; another tab ends it
	$effect(() => {
		if ($tab !== 'overview') $editMode = false;
	});
</script>

<Theme bind:theme />

{#if data.needsLogin}
	<Login missing={data.missing} />
{:else}
	<div id="layout">
		{#if $showDrawer}
			<Drawer
				onSettings={() => {
					openSettings = true;
					$showDrawer = false;
				}}
			/>
		{/if}

		<PageHeader onMenu={() => ($showDrawer = !$showDrawer)} />

		{#if $tab === 'overview'}
			<Overview />
		{:else if $tab === 'curve'}
			<Curve />
		{:else if $tab === 'assistant'}
			<Assistant />
		{:else}
			<Analysis />
		{/if}
	</div>

	<TabBar />
	<Toasts />
	{#if openSettings}
		<SettingsModal onclose={() => (openSettings = false)} />
	{/if}
	<Ask />
{/if}

<style>
	#layout {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}
</style>
