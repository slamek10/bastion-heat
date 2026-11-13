<script lang="ts">
	/**
	 * One room: its temperature from all its sensors (and how they are
	 * combined), each sensor apart, what the thermostat measures next to it,
	 * the target, heating, a window open, humidity, and 24 hours of each
	 * sensor (roomHistory, loaded once by Pregled). Line colors: the
	 * categorical slots 1-3 for a dark surface.
	 */
	import {
		alerts,
		brain,
		call,
		diagnostics,
		editMode,
		override,
		saveSettings,
		settings,
		states,
		t
	} from '$lib/stores';
	import { dewPoint } from '$lib/comfort';
	import { minutesToTarget } from '$lib/health';
	import { duration } from '$lib/format';
	import type { Room, RoomReading } from '$lib/types';
	import { numberOf, zoneFor } from '$lib/rooms';
	import type { Key } from '$lib/i18n';
	import { roomHistory } from '$lib/roomHistory.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import Icon from '@iconify/svelte';

	let { room, reading }: { room: Room; reading: RoomReading } = $props();

	const COLORS = ['#3987e5', '#d95926', '#199e70'];
	/** humidity has its own chart (another unit), in one color */
	const HUMIDITY = '#7e9bd6';
	let history = $derived(roomHistory.data);

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

	/**
	 * The user's name for a sensor, else a plain one by what it measures:
	 * Temperatura / Vlažnost / Ventil, numbered when a room has several.
	 */
	function defaultName(room: Room, id: string) {
		const numbered = (key: Key, list: string[]) =>
			list.length > 1 ? `${$t(key)} ${list.indexOf(id) + 1}` : $t(key);
		if (room.sensors.includes(id)) return numbered('label_temperature', room.sensors);
		if (room.trvs.includes(id)) return numbered('label_valve', room.trvs);
		if (id === room.humidity) return $t('label_humidity');
		return $states[id]?.attributes?.friendly_name || id;
	}
	const name = (room: Room, id: string) => room.labels?.[id] || defaultName(room, id);

	let editing = $state<string | undefined>();
	let draft = $state('');

	function startRename(room: Room, id: string) {
		editing = `${room.id}|${id}`;
		draft = room.labels?.[id] ?? '';
	}

	/** what sets a room's target: its valves, else the main zone when its thermostat is here */
	const targetsOf = (room: Room) =>
		room.trvs.length
			? room.trvs
			: ([zoneFor(room, $settings.entities)].filter((id) => !!id) as string[]);

	/* a target set here shows at once and goes to HA after a short pause, so several taps are one call */
	let pending = $state<Record<string, number>>({});
	const timers: Record<string, ReturnType<typeof setTimeout>> = {};
	/** the brain's plan for a room it looks after */
	const planOf = (id: string) =>
		$brain?.enabled ? $brain.plans.find((plan) => plan.roomId === id && plan.managed) : undefined;

	const clock = (time: number) =>
		new Date(time).toLocaleString($settings.locale === 'hr' ? 'hr-HR' : 'en-GB', {
			...(time - Date.now() > 20 * 3_600_000 && { weekday: 'short' }),
			hour: '2-digit',
			minute: '2-digit'
		});

	function stepTarget(room: Room, current: number | undefined, delta: number) {
		// a room the brain looks after: the change holds until its schedule next changes
		if (planOf(room.id)) {
			if (current === undefined) return;
			const next = Math.min(30, Math.max(5, Math.round((current + delta * 0.5) * 2) / 2));
			pending[room.id] = next;
			clearTimeout(timers[room.id]);
			timers[room.id] = setTimeout(async () => {
				await override(room.id, next);
				delete pending[room.id];
			}, 900);
			return;
		}
		const entities = targetsOf(room);
		if (current === undefined || !entities.length) return;
		const attributes = $states[entities[0]]?.attributes ?? {};
		const size = Number(attributes.target_temp_step) || 0.5;
		let next = Math.round((current + delta * size) / size) * size;
		if (attributes.min_temp !== undefined) next = Math.max(attributes.min_temp, next);
		if (attributes.max_temp !== undefined) next = Math.min(attributes.max_temp, next);
		pending[room.id] = next;
		clearTimeout(timers[room.id]);
		timers[room.id] = setTimeout(async () => {
			for (const entity_id of entities)
				await call('climate', 'set_temperature', { entity_id, temperature: next });
			// HA's state takes over once it reports the new target
			setTimeout(() => delete pending[room.id], 4000);
		}, 900);
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

	/** an empty name goes back to the default (Temperatura, Vlažnost, Ventil) */
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
			<input bind:value={draft} placeholder={defaultName(room, id)} autofocus />
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

{#key room.id}
	{@const chart = lines(room.sensors)}
	{@const wet = room.humidity ? lines([room.humidity], 2, H / 2) : undefined}
	<Panel icon={room.icon || 'mdi:home-thermometer-outline'} title={room.name}>
		{#snippet head()}
			{#if reading.controlled && reading.heating}<span class="tag heat"
					><Icon icon="mdi:fire" height="0.9rem" />{$t('room_heating')}</span
				>{/if}
			{#if reading.waiting}<span class="tag waiting" title={$t('room_waiting_hint')}
					><Icon icon="mdi:fire-off" height="0.9rem" />{$t('room_waiting')}</span
				>{/if}
			{#if $alerts.some((alert) => alert.key === `airing|${room.id}`)}<span class="tag air"
					><Icon icon="mdi:weather-windy" height="0.9rem" />{$t('air_now')}</span
				>{/if}
			{#if $alerts.some((alert) => alert.key === `cold|${room.id}`)}<span class="tag cold"
					><Icon icon="mdi:snowflake-alert" height="0.9rem" />{$t('cold_now')}</span
				>{/if}
			{#if $alerts.some((alert) => alert.key === `stalled|${room.id}`)}<span class="tag cold"
					><Icon icon="mdi:thermometer-alert" height="0.9rem" />{$t('stalled_now')}</span
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
		{@const plan = planOf(room.id)}
		{@const target = pending[room.id] ?? (plan ? plan.target : reading.target)}
		{@const warming = plan ? plan.calling : reading.controlled && reading.heating}
		<div class="now" class:old={reading.old}>
			<span class="big">{reading.value ?? '—'}</span>
			{#if warming && target !== undefined && reading.value !== undefined && target > reading.value}
				<span class="towards" aria-label={$t('room_towards', { t: String(target) })}>
					<Icon icon="mdi:arrow-right" height="1.3rem" />{target.toFixed(1)}
				</span>
			{/if}
			<span class="unit">°C</span>
			{#if reading.used.length > 1}
				<span class="w-dim method"
					>{$t(`agg_${room.aggregation}` as Key)} · {reading.used.filter((u) => !u.stale)
						.length}/{reading.used.length}</span
				>
			{/if}
		</div>
		<div class="facts">
			{#if reading.humidity !== undefined}<span
					>{$t('room_humidity', { h: String(reading.humidity) })}</span
				>{/if}
			{#if reading.humidity !== undefined && reading.value !== undefined}<span class="w-dim"
					>{$t('dew_point', { t: String(dewPoint(reading.value, reading.humidity)) })}</span
				>{/if}
			{#if room.co2 && numberOf($states[room.co2]) !== undefined}<span
					>CO₂ {numberOf($states[room.co2])} ppm</span
				>{/if}
			{#if reading.thermostat !== undefined && room.trvs.length}
				<span class="w-dim">
					{$t('room_thermostat', { t: String(reading.thermostat) })}
					{#if reading.value !== undefined}
						{@const diff = Math.round((reading.thermostat - reading.value) * 10) / 10}
						<span class:w-warn={Math.abs(diff) >= 1}>({diff > 0 ? '+' : ''}{diff})</span>
					{/if}
				</span>
			{/if}
			{#if reading.old}<span class="w-warn">{$t('room_old')}</span>
			{:else if reading.value === undefined}<span class="w-warn">{$t('room_no_value')}</span>{/if}
		</div>

		{@const stats = $diagnostics?.rooms.find((entry) => entry.roomId === room.id)}
		{#if stats && reading.controlled}
			{@const eta = warming ? minutesToTarget(reading.value, target, stats.rate) : undefined}
			<div class="facts stats">
				{#if stats.rate !== undefined}
					<span
						><Icon icon="mdi:trending-up" height="0.95rem" />{$t('stats_rate', {
							r: String(stats.rate)
						})}</span
					>
					{#if eta !== undefined}<span class="eta"
							>{$t('stats_eta', { m: duration(eta * 60, $settings.locale) })}</span
						>{/if}
				{:else if stats.hoursDay > 0}
					<span class="w-dim">{$t('stats_none')}</span>
				{/if}
				{#if stats.hoursDay > 0}<span class="w-dim"
						>{$t('stats_hours', { h: String(stats.hoursDay) })}</span
					>{/if}
			</div>
		{/if}
		{#if target !== undefined && (plan || (reading.controlled && targetsOf(room).length))}
			<div class="target">
				<span class="w-dim">{$t('target_temp')}</span>
				<button
					class="step"
					onclick={() => stepTarget(room, target, -1)}
					aria-label={$t('target_down')}><Icon icon="mdi:minus" height="1.1rem" /></button
				>
				<strong>{target.toFixed(1)}°</strong>
				<button
					class="step"
					onclick={() => stepTarget(room, target, 1)}
					aria-label={$t('target_up')}><Icon icon="mdi:plus" height="1.1rem" /></button
				>
			</div>
		{/if}
		{#if plan}
			<p class="plan">
				<Icon
					icon={plan.source === 'override' ? 'mdi:hand-back-right-outline' : 'mdi:calendar-clock'}
					height="0.95rem"
				/>
				<span
					>{plan.source === 'override' ? $t('plan_override') : $t('plan_schedule')}{#if plan.until}
						{$t('plan_until', { time: clock(plan.until) })}{/if}</span
				>
				<span class="w-dim"
					>· {plan.reason === 'brain_window'
						? $t('plan_window')
						: plan.calling
							? $t('plan_calling')
							: $t('plan_warm')}</span
				>
				{#if plan.source === 'override'}
					<button class="w-pill small" onclick={() => override(room.id, null)}
						>{$t('plan_back')}</button
					>
				{/if}
				{#if $brain?.dryRun}<span class="tag trial">{$t('brain_trial')}</span>{/if}
			</p>
		{/if}

		{#if $editMode}
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
		{/if}

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
			{#if room.sensors.length > 1}
				<div class="legend">
					{#each room.sensors as id, index (id)}
						<span><i style:background={COLORS[index % COLORS.length]}></i>{name(room, id)}</span>
					{/each}
				</div>
			{/if}
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
{/key}

<style>
	.plan {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin: 0.2rem 0 0.6rem;
		font-size: 0.85rem;
	}

	.tag.trial {
		background: rgba(255, 210, 122, 0.18);
		color: #ffd27a;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.55rem;
		border-radius: 1rem;
		font-size: 0.75rem;
	}

	.tag.waiting {
		opacity: 0.7;
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

	.now.old .big {
		opacity: 0.6;
	}

	.towards {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		margin-left: 0.4rem;
		font-size: 1.5rem;
		font-weight: 300;
		color: #ffb48f;
		font-variant-numeric: tabular-nums;
	}

	.target {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0.2rem 0 0.4rem;
	}

	.target .w-dim {
		margin-right: auto;
		font-size: 0.88rem;
	}

	.target strong {
		min-width: 3.2rem;
		text-align: center;
		font-size: 1.2rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.step {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.08);
		color: inherit;
		cursor: pointer;
	}

	.step:hover {
		background: rgba(255, 255, 255, 0.16);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.9rem;
		margin-top: 0.3rem;
		font-size: 0.78rem;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.legend i {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 2px;
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

	.stats {
		margin-top: -0.2rem;
	}

	.stats span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.eta {
		color: #ffb48f;
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
</style>
