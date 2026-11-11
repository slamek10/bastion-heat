<script lang="ts">
	/**
	 * Every room: its temperature from all its sensors (and how they are
	 * combined), each sensor apart, what the thermostat measures next to it,
	 * the target, heating, a window open, humidity, and 24 hours of each
	 * sensor. Line colors: the categorical slots 1-3 for a dark surface.
	 */
	import { rooms, settings, states, t } from '$lib/stores';
	import { numberOf } from '$lib/rooms';
	import type { Key } from '$lib/i18n';
	import Panel from '$lib/components/Panel.svelte';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	const COLORS = ['#3987e5', '#d95926', '#199e70'];
	type Point = { t: number; v: number };
	let history = $state<Record<string, Point[]>>({});

	/** HA's minimal history rows: the first full, then s / a / lu */
	function parse(
		id: string,
		rows: { s: string; a?: Record<string, any>; lu?: number; lc?: number }[]
	): Point[] {
		const climate = id.startsWith('climate.');
		let attributes: Record<string, any> = {};
		const points: Point[] = [];
		for (const row of rows) {
			if (row.a) attributes = row.a;
			const seconds = row.lu ?? row.lc;
			if (typeof seconds !== 'number') continue;
			const v = parseFloat(climate ? attributes.current_temperature : row.s);
			if (Number.isFinite(v)) points.push({ t: seconds * 1000, v });
		}
		return points;
	}

	async function load() {
		const ids = [...new Set($settings.rooms.flatMap((room) => room.sensors))];
		if (!ids.length) return;
		const response = await fetch(
			`/_api/ha/history?hours=24&ids=${encodeURIComponent(ids.join(','))}`
		).catch(() => undefined);
		if (!response?.ok) return;
		const body = await response.json();
		history = Object.fromEntries(
			Object.entries(body).map(([id, rows]) => [id, parse(id, rows as never)])
		);
	}

	onMount(() => {
		load();
		const timer = setInterval(load, 10 * 60_000);
		return () => clearInterval(timer);
	});

	const W = 360;
	const H = 90;
	function lines(sensors: string[]) {
		const start = Date.now() - 24 * 3_600_000;
		const all = sensors.flatMap((id) => history[id] ?? []).map((p) => p.v);
		if (!all.length) return undefined;
		const min = Math.floor(Math.min(...all) - 0.5);
		const max = Math.ceil(Math.max(...all) + 0.5);
		const x = (time: number) => ((Math.max(start, time) - start) / (24 * 3_600_000)) * W;
		const y = (value: number) => H - ((value - min) / (max - min || 1)) * (H - 8) - 4;
		return {
			min,
			max,
			paths: sensors.map((id) =>
				(history[id] ?? [])
					.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
					.join(' ')
			)
		};
	}

	const name = (id: string) => $states[id]?.attributes?.friendly_name ?? id;
</script>

<main class="page">
	{#if !$rooms.length}
		<p class="w-card">{$t('no_rooms')}</p>
	{/if}
	<div class="panels">
		{#each $rooms as { room, reading } (room.id)}
			{@const chart = lines(room.sensors)}
			<Panel icon={room.icon || 'mdi:home-thermometer-outline'} title={room.name}>
				{#snippet head()}
					{#if reading.heating}<span class="tag heat"
							><Icon icon="mdi:fire" height="0.9rem" />{$t('room_heating')}</span
						>{/if}
					{#if reading.windowOpen}<span class="tag window"
							><Icon icon="mdi:window-open-variant" height="0.9rem" />{$t('room_window')}</span
						>{/if}
				{/snippet}

				<div class="now">
					<span class="big">{reading.value ?? '—'}</span><span class="unit">°C</span>
					<span class="w-dim method"
						>{$t(`agg_${room.aggregation}` as Key)} · {reading.used.filter((u) => !u.stale)
							.length}/{reading.used.length}</span
					>
				</div>
				<div class="facts">
					{#if reading.thermostat !== undefined}
						<span>
							{$t('room_thermostat', { t: String(reading.thermostat) })}
							{#if reading.value !== undefined}
								{@const diff = Math.round((reading.thermostat - reading.value) * 10) / 10}
								<span class:w-warn={Math.abs(diff) >= 1}>({diff > 0 ? '+' : ''}{diff})</span>
							{/if}
						</span>
					{/if}
					{#if reading.target !== undefined}<span
							>{$t('room_target', { t: String(reading.target) })}</span
						>{/if}
					{#if reading.humidity !== undefined}<span
							>{$t('room_humidity', { h: String(reading.humidity) })}</span
						>{/if}
					{#if reading.value === undefined}<span class="w-warn">{$t('room_no_value')}</span>{/if}
				</div>

				<table class="w-data">
					<tbody>
						{#each reading.used as sensor, index (sensor.entity)}
							<tr class:stale={sensor.stale}>
								<td
									><span class="swatch" style:background={COLORS[index % COLORS.length]}
									></span>{name(sensor.entity)}</td
								>
								<td class="num">
									{sensor.value ?? '—'}°C
									{#if sensor.stale}<span class="w-warn"> · {$t('stale')}</span>{/if}
								</td>
							</tr>
						{/each}
						{#each room.trvs as trv (trv)}
							<tr>
								<td class="w-dim"><Icon icon="mdi:radiator" height="0.9rem" /> {name(trv)}</td>
								<td class="num w-dim">
									{numberOf($states[trv], 'current_temperature') ?? '—'} → {numberOf(
										$states[trv],
										'temperature'
									) ?? '—'}°C
								</td>
							</tr>
						{/each}
					</tbody>
				</table>

				{#if chart}
					<svg viewBox="0 0 {W} {H}" role="img" aria-label={$t('last_24h')}>
						{#each chart.paths as path, index (index)}
							<path
								d={path}
								fill="none"
								stroke={COLORS[index % COLORS.length]}
								stroke-width="2"
								stroke-linejoin="round"
							/>
						{/each}
					</svg>
					<div class="range w-dim">
						<span>{chart.min}°</span><span>{$t('last_24h')}</span><span>{chart.max}°</span>
					</div>
				{/if}
			</Panel>
		{/each}
	</div>
</main>

<style>
	.page {
		padding: 0 2rem calc(7rem + env(safe-area-inset-bottom));
		color: white;
	}

	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
		gap: 1rem;
		align-items: start;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.55rem;
		border-radius: 1rem;
		font-size: 0.75rem;
	}

	.tag.heat {
		background: rgba(217, 89, 38, 0.3);
		color: #ffb48f;
	}

	.tag.window {
		background: rgba(57, 135, 229, 0.3);
		color: #a9cdf6;
	}

	.now {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
	}

	.big {
		font-size: 2.6rem;
		font-weight: 300;
		font-variant-numeric: tabular-nums;
	}

	.unit {
		opacity: 0.7;
	}

	.method {
		margin-left: auto;
		font-size: 0.8rem;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		margin: 0.3rem 0 0.6rem;
		font-size: 0.88rem;
	}

	tr.stale td {
		opacity: 0.55;
	}

	.swatch {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 2px;
		margin-right: 0.4rem;
	}

	svg {
		width: 100%;
		height: auto;
		display: block;
		margin-top: 0.6rem;
	}

	.range {
		display: flex;
		justify-content: space-between;
		font-size: 0.72rem;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(7rem + env(safe-area-inset-bottom));
		}

		.panels {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
