<script lang="ts">
	/**
	 * Every room: its temperature from all its sensors (and how they are
	 * combined), each sensor apart, what the thermostat measures next to it,
	 * the target, heating, a window open, humidity, and 24 hours of each
	 * sensor. Line colors: the categorical slots 1-3 for a dark surface.
	 */
	import { alerts, editMode, rooms, saveSettings, settings, states, t } from '$lib/stores';
	import { dewPoint } from '$lib/comfort';
	import type { Room } from '$lib/types';
	import { numberOf } from '$lib/rooms';
	import type { Key } from '$lib/i18n';
	import Panel from '$lib/components/Panel.svelte';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	const COLORS = ['#3987e5', '#d95926', '#199e70'];
	/** humidity has its own chart (another unit), in one color */
	const HUMIDITY = '#7e9bd6';
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
		const ids = [
			...new Set(
				$settings.rooms.flatMap((room) => [
					...room.sensors,
					...(room.humidity ? [room.humidity] : [])
				])
			)
		];
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
	function lines(sensors: string[], pad = 0.5, height = H) {
		const start = Date.now() - 24 * 3_600_000;
		const all = sensors.flatMap((id) => history[id] ?? []).map((p) => p.v);
		if (!all.length) return undefined;
		const min = Math.floor(Math.min(...all) - pad);
		const max = Math.ceil(Math.max(...all) + pad);
		const x = (time: number) => ((Math.max(start, time) - start) / (24 * 3_600_000)) * W;
		const y = (value: number) => height - ((value - min) / (max - min || 1)) * (height - 8) - 4;
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

	/** the user's name for a sensor, else HA's */
	const name = (room: Room, id: string) =>
		room.labels?.[id] || $states[id]?.attributes?.friendly_name || id;

	let editing = $state<string | undefined>();
	let draft = $state('');

	function startRename(room: Room, id: string) {
		editing = `${room.id}|${id}`;
		draft = room.labels?.[id] ?? '';
	}

	/** a room's own name, saved when the field is left */
	async function renameRoom(room: Room, value: string) {
		const name = value.trim().slice(0, 60);
		if (!name || name === room.name) return;
		await saveSettings({
			rooms: $settings.rooms.map((entry) => (entry.id === room.id ? { ...entry, name } : entry))
		}).catch(() => {});
	}

	/* leaving edit mode drops an open rename */
	$effect(() => {
		if (!$editMode) editing = undefined;
	});

	/** an empty name goes back to Home Assistant's */
	async function rename(room: Room, id: string) {
		editing = undefined;
		const labels = { ...room.labels };
		if (draft.trim()) labels[id] = draft.trim();
		else delete labels[id];
		await saveSettings({
			rooms: $settings.rooms.map((entry) => (entry.id === room.id ? { ...entry, labels } : entry))
		}).catch(() => {});
	}
</script>

{#snippet label(room: Room, id: string)}
	{#if editing === `${room.id}|${id}`}
		<form
			class="rename"
			onsubmit={(event) => {
				event.preventDefault();
				rename(room, id);
			}}
		>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={draft}
				placeholder={$states[id]?.attributes?.friendly_name ?? id}
				autofocus
			/>
			<button class="w-pill small">{$t('save')}</button>
		</form>
	{:else}
		<span class="label">{name(room, id)}</span>
		{#if $editMode}<button
				class="pencil"
				onclick={() => startRename(room, id)}
				aria-label={$t('rename')}
				title={$t('rename')}
			>
				<Icon icon="mdi:pencil-outline" height="0.85rem" />
			</button>{/if}
	{/if}
{/snippet}

<main class="page">
	{#if !$rooms.length}
		<p class="w-card">{$t('no_rooms')}</p>
	{/if}
	<div class="panels">
		{#each $rooms as { room, reading } (room.id)}
			{@const chart = lines(room.sensors)}
			{@const wet = room.humidity ? lines([room.humidity], 2, H / 2) : undefined}
			<Panel icon={room.icon || 'mdi:home-thermometer-outline'} title={room.name}>
				{#snippet head()}
					{#if reading.heating}<span class="tag heat"
							><Icon icon="mdi:fire" height="0.9rem" />{$t(
								reading.byBoiler ? 'room_boiler_heating' : 'room_heating'
							)}</span
						>{/if}
					{#if $alerts.some((alert) => alert.key === `airing|${room.id}`)}<span class="tag air"
							><Icon icon="mdi:weather-windy" height="0.9rem" />{$t('air_now')}</span
						>{/if}
					{#if $alerts.some((alert) => alert.key === `cold|${room.id}`)}<span class="tag cold"
							><Icon icon="mdi:snowflake-alert" height="0.9rem" />{$t('cold_now')}</span
						>{/if}
					{#if reading.windowOpen}<span class="tag window"
							><Icon icon="mdi:window-open-variant" height="0.9rem" />{$t('room_window')}</span
						>{/if}
				{/snippet}

				{#if $editMode}
					<label class="room-name">
						<span class="w-dim">{$t('room_rename')}</span>
						<input
							value={room.name}
							maxlength="60"
							onchange={(event) => renameRoom(room, event.currentTarget.value)}
							onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
						/>
					</label>
				{/if}
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
					{#if reading.humidity !== undefined && reading.value !== undefined}<span class="w-dim"
							>{$t('dew_point', { t: String(dewPoint(reading.value, reading.humidity)) })}</span
						>{/if}
					{#if room.co2 && numberOf($states[room.co2]) !== undefined}<span
							>CO₂ {numberOf($states[room.co2])} ppm</span
						>{/if}
					{#if reading.value === undefined}<span class="w-warn">{$t('room_no_value')}</span>{/if}
				</div>

				<table class="w-data">
					<tbody>
						{#each reading.used as sensor, index (sensor.entity)}
							<tr class:stale={sensor.stale}>
								<td>
									<span class="swatch" style:background={COLORS[index % COLORS.length]}></span>
									{@render label(room, sensor.entity)}
								</td>
								<td class="num">
									{sensor.value ?? '—'}°C
									{#if sensor.stale}<span class="w-warn"> · {$t('stale')}</span>{/if}
								</td>
							</tr>
						{/each}
						{#if room.humidity}
							<tr>
								<td>
									<span class="swatch" style:background={HUMIDITY}></span>
									{@render label(room, room.humidity)}
								</td>
								<td class="num">{reading.humidity ?? '—'}%</td>
							</tr>
						{/if}
						{#each room.trvs as trv (trv)}
							<tr>
								<td class="w-dim">
									<Icon icon="mdi:radiator" height="0.9rem" />
									{@render label(room, trv)}
								</td>
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
				{#if wet}
					<svg
						class="humidity"
						viewBox="0 0 {W} {H / 2}"
						role="img"
						aria-label={$t('room_humidity_chart')}
					>
						<path
							d={wet.paths[0]}
							fill="none"
							stroke={HUMIDITY}
							stroke-width="2"
							stroke-linejoin="round"
						/>
					</svg>
					<div class="range w-dim">
						<span>{wet.min}%</span><span>{$t('room_humidity_chart')}</span><span>{wet.max}%</span>
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

	.tag.air {
		background: rgba(25, 158, 112, 0.3);
		color: #9ee6c8;
	}

	.tag.cold {
		background: rgba(57, 135, 229, 0.35);
		color: #cfe3fb;
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

	.pencil {
		display: inline-flex;
		padding: 0.15rem;
		margin-left: 0.2rem;
		border: none;
		border-radius: 50%;
		background: none;
		color: inherit;
		opacity: 0.45;
		cursor: pointer;
		vertical-align: middle;
	}

	.pencil:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.1);
	}

	.room-name {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.6rem;
		font-size: 0.85rem;
	}

	.room-name input {
		flex: 1;
		min-width: 0;
		padding: 0.35rem 0.6rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.3);
		background: rgba(0, 0, 0, 0.3);
		color: white;
		font-family: inherit;
		font-size: 0.95rem;
	}

	.rename {
		display: inline-flex;
		gap: 0.35rem;
	}

	.rename input {
		width: 11rem;
		padding: 0.25rem 0.55rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(0, 0, 0, 0.3);
		color: white;
		font-family: inherit;
	}

	svg.humidity {
		margin-top: 0.4rem;
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
