<script lang="ts">
	/**
	 * Energy per heating degree-day: this season against the last one up to
	 * the same day, the last twelve months, and every season. One measure,
	 * one axis, one color (the categorical slot 1 for a dark surface).
	 */
	import { t } from '$lib/stores';
	import type { Period } from '$lib/efficiency';
	import Panel from '$lib/components/Panel.svelte';
	import WeeklyReport from '$lib/components/WeeklyReport.svelte';
	import Consumption from '$lib/components/Consumption.svelte';
	import type { Day } from '$lib/efficiency';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	interface Efficiency {
		meters: number;
		hddBase: number;
		seasons: Period[];
		months: Period[];
		toDate: { now?: Period; before?: Period; change?: number };
		price: number;
		days: Day[];
	}
	let data = $state<Efficiency | undefined>();
	let failed = $state('');

	onMount(async () => {
		const response = await fetch('/_api/efficiency').catch(() => undefined);
		const body = await response?.json().catch(() => undefined);
		if (response?.ok) data = body;
		else failed = `${$t('eff_failed')} ${body?.error ?? ''}`;
	});

	const BAR = '#3987e5';
	let width = $state(640);
	let W = $derived(Math.max(320, width));
	const H = 220;
	const PAD = { left: 40, right: 8, top: 12, bottom: 26 };
	let bars = $derived.by(() => {
		const months = data?.months ?? [];
		const values = months.map((m) => m.perHdd ?? 0);
		const max = Math.max(...values, 0.1) * 1.1;
		const step = (W - PAD.left - PAD.right) / Math.max(months.length, 1);
		const barWidth = Math.min(step * 0.64, 56);
		const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom);
		const ticks = [0, max / 2, max].map((v) => Math.round(v * 10) / 10);
		return {
			ticks: ticks.map((v) => ({ v, y: y(v) })),
			items: months.map((month, i) => ({
				month,
				x: PAD.left + i * step + (step - barWidth) / 2,
				width: barWidth,
				y: y(month.perHdd ?? 0),
				height: H - PAD.bottom - y(month.perHdd ?? 0)
			}))
		};
	});

	const label = (key: string) => {
		const [year, month] = key.split('-').map(Number);
		return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short' });
	};
	const money = (value?: number) => (value === undefined ? '—' : `${value.toFixed(2)} €`);
</script>

<main class="page">
	<WeeklyReport />
	{#if failed}
		<p class="w-card warn">{failed}</p>
	{:else if !data}
		<p class="w-card w-dim">{$t('loading')}</p>
	{:else}
		{#if !data.meters}
			<p class="w-card hint">
				<Icon icon="mdi:information-outline" height="1.1rem" />{$t('eff_no_meters')}
			</p>
		{/if}
		<div class="stats">
			<div class="w-card stat">
				<small>{$t('eff_this_season', { season: data.toDate.now?.key ?? '—' })}</small>
				<strong>{data.toDate.now?.perHdd ?? '—'}</strong>
				<span class="w-dim">{$t('eff_unit')}</span>
			</div>
			<div class="w-card stat">
				<small>{$t('eff_last_season', { season: data.toDate.before?.key ?? '—' })}</small>
				<strong>{data.toDate.before?.perHdd ?? '—'}</strong>
				<span class="w-dim">{$t('eff_unit')}</span>
			</div>
			<div class="w-card stat">
				<small>{$t('eff_change')}</small>
				{#if data.toDate.change !== undefined}
					<strong class:better={data.toDate.change < 0} class:worse={data.toDate.change > 0}>
						<Icon
							icon={data.toDate.change <= 0 ? 'mdi:trending-down' : 'mdi:trending-up'}
							height="1.3rem"
						/>
						{data.toDate.change > 0 ? '+' : ''}{data.toDate.change}%
					</strong>
					<span class="w-dim">{$t(data.toDate.change <= 0 ? 'eff_better' : 'eff_worse')}</span>
				{:else}
					<strong>—</strong>
				{/if}
			</div>
			<div class="w-card stat">
				<small>{$t('eff_hdd_season')}</small>
				<strong>{data.toDate.now?.hdd ?? '—'}</strong>
				<span class="w-dim">{$t('eff_hdd_hint', { base: String(data.hddBase) })}</span>
			</div>
		</div>

		{#if data.meters}<Consumption days={data.days} price={data.price} />{/if}

		<Panel icon="mdi:chart-bar" title={$t('eff_months')} wide>
			{#if bars.items.some((item) => item.month.perHdd !== undefined)}
				<div class="chart" bind:clientWidth={width}>
					<svg viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label={$t('eff_months')}>
						{#each bars.ticks as tick (tick.v)}
							<line class="grid" x1={PAD.left} x2={W - PAD.right} y1={tick.y} y2={tick.y} />
							<text class="axis" x={PAD.left - 6} y={tick.y + 4} text-anchor="end">{tick.v}</text>
						{/each}
						{#each bars.items as item (item.month.key)}
							<g class="bar">
								<title
									>{label(item.month.key)}: {item.month.perHdd ?? '—'}
									{$t('eff_unit')} · {item.month.kwh} kWh · {item.month.hdd} °Cd</title
								>
								<rect
									class="hit"
									x={item.x - 4}
									y={PAD.top}
									width={item.width + 8}
									height={H - PAD.top - PAD.bottom}
								/>
								{#if item.height > 0}
									<rect
										x={item.x}
										y={item.y}
										width={item.width}
										height={item.height}
										rx="4"
										fill={BAR}
									/>
								{/if}
							</g>
							<text class="axis" x={item.x + item.width / 2} y={H - 8} text-anchor="middle"
								>{label(item.month.key)}</text
							>
						{/each}
					</svg>
				</div>
			{:else}
				<p class="w-dim">{$t('eff_no_data')}</p>
			{/if}
			<div class="w-scroll">
				<table class="w-data">
					<thead>
						<tr>
							<th>{$t('eff_month')}</th>
							<th class="num">°Cd</th>
							<th class="num">kWh</th>
							<th class="num">{$t('eff_unit')}</th>
							<th class="num">{$t('eff_cost')}</th>
						</tr>
					</thead>
					<tbody>
						{#each [...data.months].reverse() as month (month.key)}
							<tr>
								<td>{label(month.key)} {month.key.slice(0, 4)}</td>
								<td class="num">{month.hdd}</td>
								<td class="num">{month.kwh}</td>
								<td class="num">{month.perHdd ?? '—'}</td>
								<td class="num">{money(month.cost)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Panel>

		<Panel icon="mdi:calendar-range" title={$t('eff_seasons')} wide>
			<div class="w-scroll">
				<table class="w-data">
					<thead>
						<tr>
							<th>{$t('eff_season')}</th>
							<th class="num">{$t('eff_days')}</th>
							<th class="num">°Cd</th>
							<th class="num">kWh</th>
							<th class="num">{$t('eff_unit')}</th>
							<th class="num">{$t('eff_cost')}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.seasons as season (season.key)}
							<tr>
								<td>{season.key}</td>
								<td class="num">{season.days}</td>
								<td class="num">{season.hdd}</td>
								<td class="num">{season.kwh}</td>
								<td class="num">{season.perHdd ?? '—'}</td>
								<td class="num">{money(season.cost)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="w-dim note">{$t('eff_note')}</p>
		</Panel>
	{/if}
</main>

<style>
	.page {
		padding: 0 2rem calc(7rem + env(safe-area-inset-bottom));
		color: white;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.hint {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.8rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat small {
		opacity: 0.7;
	}

	.stat strong {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 1.6rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.stat span {
		font-size: 0.8rem;
	}

	.better {
		color: #8fdcbc;
	}

	.worse {
		color: #ffb48f;
	}

	.chart {
		width: 100%;
		margin-bottom: 0.8rem;
	}

	svg {
		display: block;
		max-width: 100%;
	}

	.grid {
		stroke: rgba(255, 255, 255, 0.08);
	}

	.axis {
		fill: rgba(255, 255, 255, 0.6);
		font-size: 12px;
	}

	.hit {
		fill: transparent;
	}

	.bar:hover .hit {
		fill: rgba(255, 255, 255, 0.06);
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0.6rem 0 0;
		font-size: 0.82rem;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(7rem + env(safe-area-inset-bottom));
		}
	}
</style>
