<script lang="ts">
	/** The heating curve, as on Bastion HA's card: the slope, the calculated and actual flow, and where the system is now */
	import { settings, states, t } from '$lib/stores';
	import { numberOf } from '$lib/rooms';
	import { curvePoints, targetFlow } from '$lib/curve';
	import Panel from '$lib/components/Panel.svelte';

	let e = $derived($settings.entities);
	let outdoor = $derived(numberOf(e.outdoor ? $states[e.outdoor] : undefined));
	let flow = $derived(numberOf(e.flow ? $states[e.flow] : undefined));
	let slope = $derived(numberOf(e.curve ? $states[e.curve] : undefined));
	let target = $derived(numberOf($states[e.zone], 'temperature'));
	let calculated = $derived(
		outdoor !== undefined && target !== undefined && slope !== undefined
			? targetFlow(outdoor, target, slope)
			: undefined
	);
	let delta = $derived(
		flow !== undefined && calculated !== undefined
			? Math.round((flow - calculated) * 10) / 10
			: undefined
	);

	const W = 640;
	const H = 300;
	const PAD = { left: 48, right: 16, top: 16, bottom: 34 };
	const x = (outdoor: number) => PAD.left + ((outdoor + 15) / 35) * (W - PAD.left - PAD.right);
	const y = (flow: number) => H - PAD.bottom - ((flow - 20) / 45) * (H - PAD.top - PAD.bottom);

	let line = $derived(
		target !== undefined && slope !== undefined
			? curvePoints(target, slope)
					.map((p, i) => `${i ? 'L' : 'M'}${x(p.outdoor).toFixed(1)},${y(p.flow).toFixed(1)}`)
					.join(' ')
			: ''
	);
	let area = $derived(line ? `${line} L${x(20)},${y(20)} L${x(-15)},${y(20)} Z` : '');
	let here = $derived(
		outdoor !== undefined && flow !== undefined
			? { x: x(Math.min(20, Math.max(-15, outdoor))), y: y(Math.min(65, Math.max(20, flow))) }
			: undefined
	);
</script>

<main class="page">
	<div class="stats">
		<div class="w-card stat"><small>{$t('curve_slope')}</small><strong>{slope ?? '—'}</strong></div>
		<div class="w-card stat">
			<small>{$t('flow_calculated')}</small><strong class="accent">{calculated ?? '—'}°C</strong>
		</div>
		<div class="w-card stat">
			<small>{$t('flow_actual')}</small><strong>{flow ?? '—'}°C</strong>
		</div>
		<div class="w-card stat">
			<small>{$t('deviation')}</small>
			<strong class:w-warn={delta !== undefined && Math.abs(delta) > 3}
				>{delta !== undefined ? `${delta > 0 ? '+' : ''}${delta}°C` : '—'}</strong
			>
		</div>
	</div>

	<Panel icon="mdi:chart-bell-curve-cumulative" title={$t('tab_curve')} wide>
		<svg viewBox="0 0 {W} {H}" role="img" aria-label={$t('tab_curve')}>
			<defs>
				<linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#3987e5" stop-opacity="0.35" />
					<stop offset="1" stop-color="#3987e5" stop-opacity="0" />
				</linearGradient>
			</defs>
			{#each [25, 35, 45, 55, 65] as tick (tick)}
				<line class="grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
				<text class="axis" x={PAD.left - 8} y={y(tick) + 4} text-anchor="end">{tick}°</text>
			{/each}
			{#each [-15, -10, -5, 0, 5, 10, 15, 20] as tick (tick)}
				<text class="axis" x={x(tick)} y={H - 12} text-anchor="middle">{tick}°</text>
			{/each}
			{#if area}<path d={area} fill="url(#curveFill)" />{/if}
			{#if line}<path d={line} fill="none" stroke="#3987e5" stroke-width="2.5" />{/if}
			{#if here}
				<circle class="halo" cx={here.x} cy={here.y} r="12" />
				<circle
					cx={here.x}
					cy={here.y}
					r="5.5"
					fill="#e66767"
					stroke="rgba(0,0,0,0.6)"
					stroke-width="2"
				/>
			{/if}
		</svg>
		{#if outdoor !== undefined && flow !== undefined && target !== undefined}
			<p class="w-dim tip">
				{$t('curve_tip', { outdoor: String(outdoor), flow: String(flow), target: String(target) })}
			</p>
		{/if}
	</Panel>
</main>

<style>
	.page {
		padding: 0 2rem calc(7rem + env(safe-area-inset-bottom));
		color: white;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.8rem;
		margin-bottom: 1rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.stat small {
		opacity: 0.7;
	}

	.stat strong {
		font-size: 1.6rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.accent {
		color: #7fb4f0;
	}

	/*
	 * as tall as the screen leaves after the header, the numbers, the panel's
	 * title, the tip and the tab bar, so the page doesn't scroll
	 */
	svg {
		width: 100%;
		height: clamp(10rem, 100dvh - 28rem, 26rem);
		display: block;
	}

	.grid {
		stroke: rgba(255, 255, 255, 0.08);
	}

	.axis {
		fill: rgba(255, 255, 255, 0.6);
		font-size: 11px;
	}

	.halo {
		fill: rgba(230, 103, 103, 0.25);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			fill: rgba(230, 103, 103, 0.05);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.halo {
			animation: none;
		}
	}

	.tip {
		margin: 0.6rem 0 0;
		font-size: 0.88rem;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(7rem + env(safe-area-inset-bottom));
		}

		/* the four numbers take two rows here */
		svg {
			height: clamp(9rem, 100dvh - 33rem, 20rem);
		}
	}
</style>
