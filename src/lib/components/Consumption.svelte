<script lang="ts">
	/**
	 * Heating energy as it was used: per day, week, month or year, in kWh,
	 * with the cost in the tooltip and the table. One measure, one axis, one
	 * color; a period no meter reported has no bar and says so.
	 */
	import { t, settings } from '$lib/stores';
	import { consumption, type Day, type Span } from '$lib/efficiency';
	import Panel from '$lib/components/Panel.svelte';

	let { days, price }: { days: Day[]; price: number } = $props();

	let span = $state<Span>('day');
	let buckets = $derived(consumption(days as Day[], span, price));
	let hovered = $state<number | undefined>();

	const BAR = '#3987e5';
	/** hot water, the categorical slot 2, stacked on heating */
	const DHW = '#d95926';
	let split = $derived(buckets.some((b) => b.dhw !== undefined));
	let electric = $derived(buckets.some((b) => b.electric !== undefined));
	const all = (b: { kwh: number; dhw?: number }) => b.kwh + (b.dhw ?? 0);
	let width = $state(640);
	let W = $derived(Math.max(320, width));
	const H = 220;
	const PAD = { left: 48, right: 8, top: 12, bottom: 26 };

	let chart = $derived.by(() => {
		const max = Math.max(...buckets.map(all), 1) * 1.1;
		const step = (W - PAD.left - PAD.right) / Math.max(buckets.length, 1);
		const barWidth = Math.max(2, Math.min(step - 2, 56));
		const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom);
		const ticks = [0, max / 2, max].map((v) =>
			max > 20 ? Math.round(v) : Math.round(v * 10) / 10
		);
		// at most ~12 labels under the bars
		const every = Math.ceil(buckets.length / Math.max(1, Math.floor(W / 70)));
		return {
			step,
			ticks: ticks.map((v) => ({ v, y: y(v) })),
			bars: buckets.map((bucket, i) => ({
				bucket,
				x: PAD.left + i * step + (step - barWidth) / 2,
				width: barWidth,
				y: y(bucket.kwh),
				height: H - PAD.bottom - y(bucket.kwh),
				/** hot water sits on top of heating, with a 2px gap */
				dhwY: y(all(bucket)),
				dhwHeight: Math.max(0, y(bucket.kwh) - y(all(bucket)) - 2),
				label: i % every === 0
			}))
		};
	});

	let locale = $derived($settings.locale === 'hr' ? 'hr-HR' : 'en-GB');
	function label(key: string, long = false) {
		const date = new Date(`${key}T12:00:00`);
		if (span === 'year') return key.slice(0, 4);
		if (span === 'month')
			return date.toLocaleDateString(locale, {
				month: long ? 'long' : 'short',
				...(long && { year: 'numeric' })
			});
		if (span === 'week' && long) {
			const end = new Date(date);
			end.setDate(end.getDate() + 6);
			return `${date.toLocaleDateString(locale, { day: 'numeric', month: 'numeric' })} – ${end.toLocaleDateString(locale, { day: 'numeric', month: 'numeric', year: 'numeric' })}`;
		}
		return date.toLocaleDateString(locale, {
			day: 'numeric',
			month: 'numeric',
			...(long && { weekday: 'short', year: 'numeric' })
		});
	}

	let total = $derived(buckets.reduce((sum, b) => sum + all(b), 0));
	let heatingTotal = $derived(buckets.reduce((sum, b) => sum + b.kwh, 0));
	const one = (value: number) => Math.round(value * 10) / 10;
	let withData = $derived(buckets.filter((b) => b.metered));
	const money = (value?: number) => (value === undefined ? '—' : `${value.toFixed(2)} €`);
	const SPANS: Span[] = ['day', 'week', 'month', 'year'];
</script>

<Panel icon="mdi:fire" title={$t('use_title')} wide>
	{#snippet head()}
		<div class="w-segmented" role="group" aria-label={$t('use_span')}>
			{#each SPANS as option (option)}
				<button
					class:active={span === option}
					onclick={() => ((span = option), (hovered = undefined))}>{$t(`use_${option}`)}</button
				>
			{/each}
		</div>
	{/snippet}

	{#if !withData.length}
		<p class="w-dim">{$t('eff_no_data')}</p>
	{:else}
		<p class="sum">
			<span><strong>{one(total)}</strong> kWh</span>
			{#if price > 0}<span><strong>{(total * price).toFixed(2)}</strong> €</span>{/if}
			<span class="w-dim"
				>{$t('use_avg', {
					kwh: String(Math.round((total / withData.length) * 10) / 10),
					span: $t(`use_per_${span}`)
				})}</span
			>
		</p>
		{#if split}
			<div class="legend">
				<span><i style:background={BAR}></i>{$t('use_heating')} {one(heatingTotal)} kWh</span>
				<span><i style:background={DHW}></i>{$t('use_dhw')} {one(total - heatingTotal)} kWh</span>
			</div>
		{/if}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="chart" bind:clientWidth={width} onmouseleave={() => (hovered = undefined)}>
			<svg viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label={$t('use_title')}>
				{#each chart.ticks as tick (tick.v)}
					<line class="grid" x1={PAD.left} x2={W - PAD.right} y1={tick.y} y2={tick.y} />
					<text class="axis" x={PAD.left - 6} y={tick.y + 4} text-anchor="end">{tick.v}</text>
				{/each}
				<text class="axis" x={PAD.left - 6} y={PAD.top - 2} text-anchor="end">kWh</text>
				{#each chart.bars as bar, index (bar.bucket.key)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<g onmouseenter={() => (hovered = index)}>
						<rect
							class="hit"
							class:on={hovered === index}
							x={PAD.left + index * chart.step}
							y={PAD.top}
							width={chart.step}
							height={H - PAD.top - PAD.bottom}
						/>
						{#if bar.bucket.metered && bar.height > 0}
							<rect
								x={bar.x}
								y={bar.y}
								width={bar.width}
								height={bar.height}
								rx={Math.min(4, bar.width / 2)}
								fill={BAR}
							/>
						{/if}
						{#if bar.bucket.metered && bar.dhwHeight > 0}
							<rect
								x={bar.x}
								y={bar.dhwY}
								width={bar.width}
								height={bar.dhwHeight}
								rx={Math.min(4, bar.width / 2)}
								fill={DHW}
							/>
						{/if}
						{#if !bar.bucket.metered}
							<line
								class="missing"
								x1={bar.x}
								x2={bar.x + bar.width}
								y1={H - PAD.bottom - 1}
								y2={H - PAD.bottom - 1}
							/>
						{/if}
					</g>
					{#if bar.label}
						<text class="axis" x={bar.x + bar.width / 2} y={H - 8} text-anchor="middle"
							>{label(bar.bucket.key)}</text
						>
					{/if}
				{/each}
			</svg>
			{#if hovered !== undefined && chart.bars[hovered]}
				{@const bar = chart.bars[hovered]}
				<div
					class="tip"
					style:left="{Math.min(Math.max(bar.x + bar.width / 2, 80), W - 80)}px"
					style:top="{Math.max(bar.dhwY - 8, 40)}px"
				>
					<strong>{label(bar.bucket.key, true)}</strong>
					{#if bar.bucket.metered}
						{#if split}
							<span>{$t('use_heating')}: {bar.bucket.kwh} kWh</span>
							<span>{$t('use_dhw')}: {bar.bucket.dhw ?? 0} kWh</span>
						{/if}
						<span
							>{split ? `${$t('use_total')}: ` : ''}{one(all(bar.bucket))} kWh{price > 0
								? ` · ${money(bar.bucket.cost)}`
								: ''}</span
						>
						{#if bar.bucket.electric !== undefined}<span class="w-dim"
								>{$t('use_electric')}: {bar.bucket.electric} kWh</span
							>{/if}
						{#if bar.bucket.metered < bar.bucket.days}<span class="w-dim"
								>{$t('use_partial', {
									n: String(bar.bucket.metered),
									m: String(bar.bucket.days)
								})}</span
							>{/if}
					{:else}
						<span class="w-dim">{$t('use_no_data')}</span>
					{/if}
				</div>
			{/if}
		</div>

		<div class="w-scroll">
			<table class="w-data">
				<thead>
					<tr>
						<th>{$t(`use_${span}`)}</th>
						{#if split}
							<th class="num">{$t('use_heating')}</th>
							<th class="num">{$t('use_dhw')}</th>
						{/if}
						<th class="num">{split ? $t('use_total') : 'kWh'}</th>
						{#if electric}<th class="num">{$t('use_electric')}</th>{/if}
						<th class="num">{$t('eff_cost')}</th>
						<th class="num">{$t('use_days_data')}</th>
					</tr>
				</thead>
				<tbody>
					{#each [...buckets].reverse() as bucket (bucket.key)}
						<tr>
							<td>{label(bucket.key, true)}</td>
							{#if split}
								<td class="num">{bucket.metered ? bucket.kwh : '—'}</td>
								<td class="num">{bucket.metered ? (bucket.dhw ?? 0) : '—'}</td>
							{/if}
							<td class="num">{bucket.metered ? one(all(bucket)) : '—'}</td>
							{#if electric}<td class="num">{bucket.electric ?? '—'}</td>{/if}
							<td class="num">{money(bucket.cost)}</td>
							<td class="num" class:w-warn={bucket.metered < bucket.days}
								>{bucket.metered}/{bucket.days}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Panel>

<style>
	.sum {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 1.3rem;
		margin: 0 0 0.6rem;
	}

	.sum strong {
		font-size: 1.4rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.sum .w-dim {
		font-size: 0.85rem;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.2rem;
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.legend i {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 2px;
	}

	.chart {
		position: relative;
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

	.hit.on {
		fill: rgba(255, 255, 255, 0.07);
	}

	.missing {
		stroke: rgba(255, 255, 255, 0.35);
		stroke-width: 2;
		stroke-dasharray: 3 3;
	}

	.tip {
		position: absolute;
		transform: translate(-50%, -100%);
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.4rem 0.65rem;
		border-radius: 0.5rem;
		background: rgba(20, 20, 24, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.15);
		font-size: 0.82rem;
		white-space: nowrap;
		pointer-events: none;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
