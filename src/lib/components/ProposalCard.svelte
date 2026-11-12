<script lang="ts">
	/**
	 * A change the assistant asked for: what changes and why, the schedule
	 * before and after, and Potvrdi / Odbij. Nothing happens until one is pressed.
	 */
	import { now, settings, t, toast } from '$lib/stores';
	import type { Key } from '$lib/i18n';
	import type { Proposal, RoomSchedule } from '$lib/types';
	import Icon from '@iconify/svelte';

	let { proposal, ondecided }: { proposal: Proposal; ondecided: (next: Proposal) => void } =
		$props();

	let sending = $state(false);
	let status = $derived(
		proposal.status === 'waiting' && proposal.expires <= $now ? 'expired' : proposal.status
	);

	const DAYS = $derived(
		$settings.locale === 'hr'
			? ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned']
			: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
	);
	const days = (list: number[]) => list.map((day) => DAYS[day - 1]).join(' ');

	async function answer(confirm: boolean) {
		sending = true;
		const response = await fetch(`/_api/assistant/proposals/${proposal.id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm })
		}).catch(() => undefined);
		sending = false;
		const body = await response?.json().catch(() => undefined);
		if (body?.id) ondecided(body);
		if (!response?.ok)
			toast({
				title: $t('call_failed'),
				message: body?.error ?? String(response?.status ?? ''),
				alert: true
			});
	}

	const STATUS: Record<string, Key> = {
		done: 'proposal_done',
		rejected: 'proposal_rejected',
		expired: 'proposal_expired',
		failed: 'proposal_failed'
	};
</script>

{#snippet week(schedule: RoomSchedule)}
	<ul class="blocks">
		{#each schedule.blocks as block, index (index)}
			<li>
				<span>{days(block.days)}</span><span class="num">{block.from}–{block.to}</span><strong
					>{block.temp.toFixed(1)}°</strong
				>
			</li>
		{/each}
		<li class="w-dim">
			<span>{$t('proposal_base')}</span><span></span><strong>{schedule.base.toFixed(1)}°</strong>
		</li>
	</ul>
{/snippet}

<div class="card" class:waiting={status === 'waiting'}>
	<div class="head">
		<Icon
			icon={proposal.kind === 'schedule' ? 'mdi:calendar-edit' : 'mdi:thermometer-lines'}
			height="1.1rem"
		/>
		<strong>{proposal.kind === 'schedule' ? $t('proposal_schedule') : $t('proposal_target')}</strong
		>
		<span class="w-dim">{proposal.roomName}</span>
	</div>
	<p class="reason">{proposal.reason}</p>

	{#if proposal.kind === 'schedule' && proposal.schedule}
		<div class="compare">
			{#if proposal.before}
				<div>
					<small class="w-dim">{$t('proposal_now')}</small>
					{@render week(proposal.before)}
				</div>
			{/if}
			<div>
				<small class="w-dim">{$t('proposal_new')}</small>
				{@render week(proposal.schedule)}
				{#if !proposal.schedule.enabled}<small class="w-warn">{$t('proposal_disabled')}</small>{/if}
			</div>
		</div>
	{:else if proposal.temperature !== undefined}
		<p class="big">{proposal.temperature.toFixed(1)}°C</p>
	{/if}

	{#if status === 'waiting'}
		<div class="buttons">
			<button class="w-pill" disabled={sending} onclick={() => answer(false)}>
				<Icon icon="mdi:close" height="1rem" />{$t('proposal_reject')}
			</button>
			<button class="w-pill primary" disabled={sending} onclick={() => answer(true)}>
				<Icon icon={sending ? 'mdi:loading' : 'mdi:check'} height="1rem" />{$t('proposal_confirm')}
			</button>
		</div>
	{:else}
		<p class="status" class:w-bad={status === 'failed'}>
			{$t(STATUS[status])}{#if proposal.error}: {proposal.error}{/if}
		</p>
	{/if}
</div>

<style>
	.card {
		align-self: flex-start;
		width: min(30rem, 92%);
		padding: 0.8rem 0.95rem;
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(0, 0, 0, 0.25);
		font-size: 0.9rem;
	}

	.card.waiting {
		border-color: rgba(255, 210, 122, 0.5);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.head .w-dim {
		margin-left: auto;
	}

	.reason {
		margin: 0.4rem 0 0.6rem;
		opacity: 0.85;
	}

	.compare {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.8rem;
	}

	.blocks {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.blocks li {
		display: grid;
		grid-template-columns: 1fr auto 3rem;
		gap: 0.5rem;
		font-variant-numeric: tabular-nums;
	}

	.blocks strong {
		text-align: right;
		font-weight: 500;
	}

	.big {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 300;
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.8rem;
	}

	.status {
		margin: 0.7rem 0 0;
		font-size: 0.82rem;
		opacity: 0.8;
	}
</style>
