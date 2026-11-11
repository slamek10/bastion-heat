<script lang="ts">
	/** The weekly reports: pick one, or make one for the last seven days now */
	import { t, toast } from '$lib/stores';
	import type { Report } from '$lib/server/report';
	import type { Key } from '$lib/i18n';
	import Panel from '$lib/components/Panel.svelte';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	let reports = $state<Report[]>([]);
	let chosen = $state<string | undefined>();
	let making = $state(false);
	let report = $derived(reports.find((entry) => entry.id === chosen) ?? reports[0]);

	onMount(async () => {
		const response = await fetch('/_api/report').catch(() => undefined);
		if (response?.ok) reports = await response.json();
	});

	async function makeNow() {
		making = true;
		const response = await fetch('/_api/report', { method: 'POST' }).catch(() => undefined);
		const body = await response?.json().catch(() => undefined);
		making = false;
		if (!response?.ok) {
			toast({ title: $t('report_failed'), message: body?.error ?? '', alert: true });
			return;
		}
		reports = [body, ...reports];
		chosen = body.id;
	}

	const day = (ms: number) =>
		new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' });
	const span = (entry: Report) => `${day(entry.start)} – ${day(entry.end - 1)}`;
	const diff = (avg?: number, target?: number) =>
		avg !== undefined && target !== undefined ? Math.round((avg - target) * 10) / 10 : undefined;
</script>

<Panel icon="mdi:file-chart-outline" title={$t('report_title')} wide>
	{#snippet head()}
		{#if reports.length > 1}
			<select
				class="pick"
				value={report?.id}
				onchange={(e) => (chosen = e.currentTarget.value)}
				aria-label={$t('report_pick')}
			>
				{#each reports as entry (entry.id)}<option value={entry.id}>{span(entry)}</option>{/each}
			</select>
		{/if}
		<button class="w-pill small" onclick={makeNow} disabled={making}>
			<Icon
				icon={making ? 'mdi:loading' : 'mdi:refresh'}
				height="1rem"
				class={making ? 'spin' : ''}
			/>
			{$t('report_now')}
		</button>
	{/snippet}

	{#if !report}
		<p class="w-dim">{$t('report_none')}</p>
	{:else}
		<p class="w-dim period">{span(report)}</p>
		<div class="energy">
			{#if report.energy.kwh !== undefined}
				<span><strong>{report.energy.kwh}</strong> kWh</span>
				{#if report.energy.cost !== undefined}<span
						><strong>{report.energy.cost.toFixed(2)}</strong> €</span
					>{/if}
			{/if}
			<span><strong>{report.energy.hdd}</strong> °Cd</span>
			{#if report.energy.perHdd !== undefined}
				<span>
					<strong>{report.energy.perHdd}</strong>
					{$t('eff_unit')}
					{#if report.energy.change !== undefined}
						<span class:better={report.energy.change < 0} class:worse={report.energy.change > 0}
							>({report.energy.change > 0 ? '+' : ''}{report.energy.change}% {$t(
								'report_vs_week'
							)})</span
						>
					{/if}
				</span>
			{/if}
		</div>

		<ul class="tips">
			{#each report.tips as tip, index (index)}
				<li>
					<Icon
						icon={tip.key === 'tip_all_good' || tip.key === 'tip_eff_better'
							? 'mdi:check-circle-outline'
							: 'mdi:lightbulb-on-outline'}
						height="1.1rem"
					/>
					<span>{$t(tip.key as Key, tip.vars)}</span>
				</li>
			{/each}
		</ul>

		<div class="w-scroll">
			<table class="w-data">
				<thead>
					<tr>
						<th>{$t('report_room')}</th>
						<th class="num">{$t('report_avg')}</th>
						<th class="num">{$t('report_target')}</th>
						<th class="num">{$t('report_minmax')}</th>
						<th class="num">{$t('report_heating')}</th>
						<th class="num">{$t('alerts')}</th>
					</tr>
				</thead>
				<tbody>
					{#each report.rooms as room (room.id)}
						{@const d = diff(room.avg, room.target)}
						<tr>
							<td>{room.name}</td>
							<td class="num"
								>{room.avg ?? '—'}°
								{#if d !== undefined}<span class="w-dim" class:w-warn={Math.abs(d) >= 1}
										>({d > 0 ? '+' : ''}{d})</span
									>{/if}</td
							>
							<td class="num">{room.target ?? '—'}°</td>
							<td class="num">{room.min ?? '—'}° / {room.max ?? '—'}°</td>
							<td class="num">{room.heatingHours ?? '—'} h</td>
							<td class="num">
								{#if room.airing}<span title={$t('air_now')}
										><Icon icon="mdi:weather-windy" height="0.9rem" />{room.airing}</span
									>{/if}
								{#if room.cold}<span title={$t('cold_now')}
										><Icon icon="mdi:snowflake-alert" height="0.9rem" />{room.cold}</span
									>{/if}
								{#if !room.airing && !room.cold}—{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Panel>

<style>
	.pick {
		padding: 0.25rem 0.5rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(0, 0, 0, 0.3);
		color: white;
		font-family: inherit;
	}

	.period {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
	}

	.energy {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.4rem;
		margin-bottom: 0.8rem;
	}

	.energy strong {
		font-size: 1.3rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.better {
		color: #8fdcbc;
	}

	.worse {
		color: #ffb48f;
	}

	.tips {
		list-style: none;
		margin: 0 0 0.9rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.tips li {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		font-size: 0.92rem;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.num span {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		margin-left: 0.3rem;
	}
</style>
