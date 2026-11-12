<script lang="ts">
	/**
	 * Bastion HA's "Grijanje & PTV" overview: the heating circuit, hot water,
	 * the AC, water pressure and presets, plus the rooms with their combined
	 * temperatures. Changes go through /_api/ha/call.
	 */
	import {
		ago,
		alerts,
		brain,
		call,
		diagnostics,
		followDiagnostics,
		house,
		now,
		settings,
		states,
		status,
		t
	} from '$lib/stores';
	import type { AlertKind } from '$lib/types';
	import { onMount } from 'svelte';
	import type { Key } from '$lib/i18n';
	import { numberOf } from '$lib/rooms';
	import { pressureState, targetFlow } from '$lib/curve';
	import Panel from '$lib/components/Panel.svelte';
	import Rooms from '$lib/tabs/Rooms.svelte';
	import Icon from '@iconify/svelte';

	let e = $derived($settings.entities);
	let zone = $derived($states[e.zone]);
	let ac = $derived(e.ac ? $states[e.ac] : undefined);
	let outdoor = $derived(numberOf(e.outdoor ? $states[e.outdoor] : undefined));
	let flow = $derived(numberOf(e.flow ? $states[e.flow] : undefined));
	let pressure = $derived(numberOf(e.pressure ? $states[e.pressure] : undefined));
	let slope = $derived(numberOf(e.curve ? $states[e.curve] : undefined));
	let indoor = $derived(
		numberOf(e.indoor ? $states[e.indoor] : undefined) ?? numberOf(zone, 'current_temperature')
	);
	let dhw = $derived(e.dhw ? $states[e.dhw] : undefined);
	let waterHeater = $derived(e.waterHeater ? $states[e.waterHeater] : undefined);

	// what was asked for, until HA reports it back
	let pendingZone = $state<number | undefined>();
	let pendingAc = $state<number | undefined>();
	let zoneTarget = $derived(pendingZone ?? numberOf(zone, 'temperature'));
	let acTarget = $derived(pendingAc ?? numberOf(ac, 'temperature'));
	$effect(() => {
		if (pendingZone !== undefined && numberOf(zone, 'temperature') === pendingZone)
			pendingZone = undefined;
		if (pendingAc !== undefined && numberOf(ac, 'temperature') === pendingAc) pendingAc = undefined;
	});

	let calculated = $derived(
		outdoor !== undefined && zoneTarget !== undefined && slope !== undefined
			? targetFlow(outdoor, zoneTarget, slope)
			: undefined
	);
	let pressureNow = $derived(pressureState(pressure));
	let zoneHeating = $derived(zone?.attributes?.hvac_action === 'heating' || zone?.state === 'heat');

	function step(
		entity: string,
		current: number | undefined,
		delta: number,
		set: (value: number) => void
	) {
		if (current === undefined) return;
		const attributes = $states[entity]?.attributes ?? {};
		const size = Number(attributes.target_temp_step) || 0.5;
		let next = Math.round((current + delta * size) / size) * size;
		if (attributes.min_temp !== undefined) next = Math.max(attributes.min_temp, next);
		if (attributes.max_temp !== undefined) next = Math.min(attributes.max_temp, next);
		set(next);
		call('climate', 'set_temperature', { entity_id: entity, temperature: next });
	}

	const mode = (entity: string, hvac_mode: string) =>
		call('climate', 'set_hvac_mode', { entity_id: entity, hvac_mode });

	let applying = $state<string>();
	async function applyPreset(id: string) {
		const preset = $settings.presets.find((entry) => entry.id === id);
		if (!preset) return;
		applying = id;
		for (const target of preset.targets) {
			if (target.hvac_mode)
				await call('climate', 'set_hvac_mode', {
					entity_id: target.entity_id,
					hvac_mode: target.hvac_mode
				});
			if (target.temperature !== undefined && target.hvac_mode !== 'off') {
				await call('climate', 'set_temperature', {
					entity_id: target.entity_id,
					temperature: target.temperature
				});
			}
		}
		applying = undefined;
	}

	/** water_heater boost: an operation mode named like it, when the entity offers one */
	let boostMode = $derived(
		(waterHeater?.attributes?.operation_list as string[] | undefined)?.find((m) =>
			/boost|high_demand|performance/i.test(m)
		)
	);

	/** the brain moves the zone itself: a change here lasts until its next round */
	let brainZone = $derived(
		!!$brain?.enabled && $settings.brain.house && $brain.plans.some((plan) => plan.managed)
	);

	const time = (at: number) =>
		new Date(at).toLocaleTimeString($settings.locale === 'hr' ? 'hr-HR' : 'en-GB', {
			hour: '2-digit',
			minute: '2-digit'
		});

	onMount(followDiagnostics);

	const ALERT_ICONS: Record<AlertKind, string> = {
		cold: 'mdi:snowflake-alert',
		airing: 'mdi:window-open-variant',
		valve: 'mdi:radiator-off',
		battery: 'mdi:battery-alert-variant-outline',
		pressure: 'mdi:gauge-low',
		boiler: 'mdi:water-boiler-alert',
		stalled: 'mdi:thermometer-alert'
	};

	/** "Soba", or "Soba · Ventil 2" when the room has several valves */
	function valveName(roomId: string, entity: string) {
		const room = $settings.rooms.find((entry) => entry.id === roomId);
		if (!room) return entity;
		if (room.trvs.length < 2) return room.name;
		const own = room.labels?.[entity] || `${$t('label_valve')} ${room.trvs.indexOf(entity) + 1}`;
		return `${room.name} · ${own}`;
	}

	const batteryIcon = (level: number) =>
		level <= 10
			? 'mdi:battery-outline'
			: `mdi:battery-${Math.min(90, Math.max(10, Math.round(level / 10) * 10))}`;

	const AC_MODES = [
		{ mode: 'cool', icon: 'mdi:snowflake', key: 'ac_cool' },
		{ mode: 'heat', icon: 'mdi:fire', key: 'ac_heat' },
		{ mode: 'dry', icon: 'mdi:water-percent', key: 'ac_dry' },
		{ mode: 'fan_only', icon: 'mdi:fan', key: 'ac_fan' }
	] as const;
</script>

<main class="page">
	{#if !$status.ha}
		<p class="w-card warn">{$t('ha_down')}</p>
	{/if}

	<div class="chips">
		<span class="chip"
			><Icon icon="mdi:home-thermometer-outline" height="1rem" />{$t('indoor')}
			<strong>{indoor ?? '—'}°C</strong></span
		>
		{#if $house !== undefined}
			<span class="chip"
				><Icon icon="mdi:home-group" height="1rem" />{$t('house_avg')}
				<strong>{$house}°C</strong></span
			>
		{/if}
		<span class="chip"
			><Icon icon="mdi:sun-thermometer-outline" height="1rem" />{$t('outdoor')}
			<strong>{outdoor ?? '—'}°C</strong></span
		>
		<span class="chip" class:bad={pressureNow === 'low' || pressureNow === 'high'}>
			<Icon icon="mdi:gauge" height="1rem" />{$t('pressure')} <strong>{pressure ?? '—'} bar</strong>
		</span>
	</div>

	{#if $alerts.length}
		<ul class="alerts" aria-label={$t('alerts')}>
			{#each $alerts as alert (alert.key)}
				<li class="alert {alert.kind}">
					<Icon icon={ALERT_ICONS[alert.kind] ?? 'mdi:alert-outline'} height="1.2rem" />
					<span>{$t(alert.message as Key, alert.vars)}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if $settings.presets.length}
		<div class="presets">
			{#each $settings.presets as preset (preset.id)}
				<button class="w-pill" disabled={!!applying} onclick={() => applyPreset(preset.id)}>
					<Icon
						icon={applying === preset.id ? 'mdi:loading' : preset.icon || 'mdi:thermostat'}
						height="1rem"
						class={applying === preset.id ? 'spin' : ''}
					/>
					{preset.name}
				</button>
			{/each}
		</div>
	{/if}

	<div class="panels">
		{#if zone}
			<Panel icon="mdi:radiator" title={$t('circuit_title')}>
				{#snippet head()}
					<span class="w-dim">{zoneHeating ? $t('heating_active') : $t('idle')}</span>
				{/snippet}
				<div class="stepper">
					<button
						class="step"
						onclick={() => step(e.zone, zoneTarget, -1, (v) => (pendingZone = v))}
						aria-label="−"
					>
						<Icon icon="mdi:minus" height="1.4rem" />
					</button>
					<div class="value">
						<span class="big">{zoneTarget?.toFixed(1) ?? '—'}</span><span class="unit">°C</span>
						<small>{$t('target_temp')}</small>
					</div>
					<button
						class="step"
						onclick={() => step(e.zone, zoneTarget, 1, (v) => (pendingZone = v))}
						aria-label="+"
					>
						<Icon icon="mdi:plus" height="1.4rem" />
					</button>
				</div>
				<div class="w-segmented modes">
					{#each [['heat', 'mdi:fire', 'mode_heat'], ['auto', 'mdi:thermostat-auto', 'mode_auto'], ['off', 'mdi:power', 'mode_off']] as const as [m, icon, key] (m)}
						{#if (zone.attributes?.hvac_modes ?? ['heat', 'auto', 'off']).includes(m)}
							<button class:active={zone.state === m} onclick={() => mode(e.zone, m)}>
								<Icon {icon} height="1rem" />{$t(key)}
							</button>
						{/if}
					{/each}
				</div>
				{#if brainZone}
					<p class="w-dim small brain-note">
						<Icon icon="mdi:robot-outline" height="0.95rem" />{$t('brain_zone_note')}
					</p>
				{/if}
				{#if flow !== undefined}
					<p class="flow">
						{$t('flow')} <strong>{flow}°C</strong>
						{#if calculated !== undefined}<span class="w-dim"
								>({$t('flow_target', { t: String(calculated) })})</span
							>{/if}
					</p>
				{/if}
			</Panel>
		{/if}

		{#if dhw || waterHeater}
			<Panel icon="mdi:water-boiler" title={$t('dhw_title')}>
				<p class="big-line">{waterHeater?.state ?? dhw?.state ?? $t('dhw_normal')}</p>
				{#if waterHeater && boostMode}
					<button
						class="w-pill"
						class:primary={waterHeater.state === boostMode}
						onclick={() =>
							call('water_heater', 'set_operation_mode', {
								entity_id: e.waterHeater,
								operation_mode: boostMode
							})}
					>
						<Icon icon="mdi:lightning-bolt" height="1rem" />{$t('dhw_boost')}
					</button>
				{:else}
					<p class="w-dim small">{$t('dhw_no_boost')}</p>
				{/if}
			</Panel>
		{/if}

		{#if ac && e.ac}
			{@const acEntity = e.ac}
			<Panel icon="mdi:air-conditioner" title={$t('ac_title')}>
				{#snippet head()}
					<span class="w-dim">{ac.state === 'off' ? $t('ac_off') : ac.state}</span>
				{/snippet}
				<div class="stepper small">
					<button
						class="step"
						onclick={() => step(acEntity, acTarget, -2, (v) => (pendingAc = v))}
						aria-label="−"
					>
						<Icon icon="mdi:minus" height="1.2rem" />
					</button>
					<div class="value">
						<span class="big">{acTarget ?? '—'}</span><span class="unit">°C</span>
					</div>
					<button
						class="step"
						onclick={() => step(acEntity, acTarget, 2, (v) => (pendingAc = v))}
						aria-label="+"
					>
						<Icon icon="mdi:plus" height="1.2rem" />
					</button>
				</div>
				<div class="w-segmented modes">
					{#each AC_MODES as item (item.mode)}
						<button
							class:active={ac.state === item.mode}
							onclick={() => mode(acEntity, item.mode)}
							title={$t(item.key)}
						>
							<Icon icon={item.icon} height="1rem" />
						</button>
					{/each}
					<button
						class:active={ac.state === 'off'}
						onclick={() => mode(acEntity, ac.state === 'off' ? 'heat' : 'off')}
						title={$t('power')}
					>
						<Icon icon="mdi:power" height="1rem" />
					</button>
				</div>
			</Panel>
		{/if}

		{#if pressure !== undefined}
			<Panel icon="mdi:gauge" title={$t('pressure_title')}>
				<p class="big-line" class:w-bad={pressureNow === 'low' || pressureNow === 'high'}>
					{pressure} bar
				</p>
				<p class="w-dim small">
					{pressureNow === 'low'
						? $t('pressure_low')
						: pressureNow === 'high'
							? $t('pressure_high')
							: $t('pressure_ok')} · {$t('pressure_ideal')}
				</p>
			</Panel>
		{/if}

		{#if $diagnostics && ($diagnostics.valves.length || $diagnostics.quota)}
			{@const quota = $diagnostics.quota}
			<Panel icon="mdi:radiator" title={$t('health_title')}>
				{#if quota}
					<div class="quota">
						<div class="quota-head">
							<span>{$t('quota_title')}</span>
							<span class="w-dim"
								>{$t('quota_line', {
									calls: String(quota.calls),
									limit: String(quota.limit)
								})}</span
							>
						</div>
						<div
							class="bar"
							role="meter"
							aria-valuemin="0"
							aria-valuemax={quota.limit}
							aria-valuenow={quota.calls}
							aria-label={$t('quota_title')}
						>
							<i
								style:width="{Math.round(quota.used * 100)}%"
								class:warn={quota.projected !== undefined && quota.projected > quota.limit}
							></i>
						</div>
						{#if quota.projected !== undefined}
							<p
								class="small"
								class:w-dim={quota.projected <= quota.limit}
								class:w-warn={quota.projected > quota.limit}
							>
								{$t(quota.projected > quota.limit ? 'quota_over' : 'quota_projected', {
									n: String(quota.projected)
								})}
							</p>
						{/if}
					</div>
				{/if}
				{#if $diagnostics.valves.length}
					<table class="w-data valves">
						<thead>
							<tr>
								<th></th>
								<th>{$t('health_battery')}</th>
								<th>{$t('health_seen')}</th>
							</tr>
						</thead>
						<tbody>
							{#each $diagnostics.valves as valve (valve.entity)}
								<tr>
									<td>
										{valveName(valve.roomId, valve.entity)}
										{#if valve.offline}<span class="w-bad small-tag">· {$t('health_offline')}</span>
										{:else if valve.notResponding}<span class="w-warn small-tag"
												>· {$t('health_late', { asked: String(valve.notResponding.asked) })}</span
											>{/if}
									</td>
									<td class="num" class:w-warn={valve.batteryLow}>
										{#if valve.battery !== undefined}
											<Icon icon={batteryIcon(valve.battery)} height="0.95rem" />
											{valve.battery}%
										{:else}—{/if}
									</td>
									<td class="num w-dim">{valve.lastSeen ? ago(valve.lastSeen, $now) : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</Panel>
		{/if}

		{#if $brain}
			<Panel icon="mdi:robot-outline" title={$t('brain_title')}>
				{#snippet head()}
					<span class="tag" class:on={$brain.enabled && !$brain.dryRun} class:trial={$brain.dryRun}
						>{!$brain.enabled
							? $t('brain_state_off')
							: $brain.dryRun
								? $t('brain_trial')
								: $t('brain_state_on')}</span
					>
				{/snippet}
				{#if !$brain.enabled}
					<p class="w-dim small">{$t('brain_off_hint')}</p>
				{:else}
					{#if $brain.dryRun}<p class="w-dim small">{$t('brain_trial_hint')}</p>{/if}
					{#if !$brain.plans.some((plan) => plan.managed)}
						<p class="w-dim small">{$t('brain_no_schedules')}</p>
					{/if}
					{#if $brain.recent.length}
						<ul class="decisions">
							{#each $brain.recent.slice(0, 8) as item (item.at + item.entity)}
								<li class:failed={!!item.error}>
									<span class="w-dim">{time(item.at)}</span>
									<span
										>{$t(item.reason as Key, item.vars)}{#if item.error}
											· {item.error}{/if}</span
									>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="w-dim small">{$t('brain_nothing_yet')}</p>
					{/if}
				{/if}
			</Panel>
		{/if}
	</div>

	<Rooms />
</main>

<style>
	.brain-note {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0.6rem 0 0;
	}

	.tag {
		padding: 0.15rem 0.55rem;
		border-radius: 1rem;
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.1);
	}

	.tag.on {
		background: rgba(25, 158, 112, 0.3);
	}

	.tag.trial {
		background: rgba(255, 210, 122, 0.18);
		color: #ffd27a;
	}

	.decisions {
		list-style: none;
		margin: 0.3rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		font-size: 0.85rem;
	}

	.decisions li {
		display: grid;
		grid-template-columns: 3rem 1fr;
		gap: 0.4rem;
	}

	.decisions li.failed {
		color: #ff9a9a;
	}

	.alerts {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.alert {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.9rem;
		border-radius: 0.8rem;
		backdrop-filter: blur(12px);
		font-size: 0.92rem;
	}

	.alert.cold {
		background: rgba(57, 135, 229, 0.28);
		border: 1px solid rgba(169, 205, 246, 0.45);
	}

	.alert.valve,
	.alert.battery,
	.alert.stalled {
		background: rgba(255, 210, 122, 0.16);
		border: 1px solid rgba(255, 210, 122, 0.4);
	}

	.alert.pressure,
	.alert.boiler {
		background: rgba(224, 49, 47, 0.25);
		border: 1px solid rgba(255, 140, 140, 0.45);
	}

	.quota {
		margin-bottom: 0.8rem;
	}

	.quota-head {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.88rem;
		margin-bottom: 0.35rem;
	}

	.bar {
		height: 0.45rem;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.12);
		overflow: hidden;
	}

	.bar i {
		display: block;
		height: 100%;
		border-radius: 1rem;
		background: #199e70;
	}

	.bar i.warn {
		background: #e0a43a;
	}

	.quota .small {
		margin-top: 0.35rem;
	}

	.valves td {
		font-size: 0.86rem;
	}

	.valves .num {
		white-space: nowrap;
	}

	.small-tag {
		font-size: 0.78rem;
	}

	.alert.airing {
		background: rgba(25, 158, 112, 0.25);
		border: 1px solid rgba(140, 220, 190, 0.4);
	}

	.page {
		padding: 0 2rem calc(7rem + env(safe-area-inset-bottom));
		color: white;
		min-width: 0;
	}

	.warn {
		color: #ffd27a;
		margin: 0 0 1rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.9rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.85rem;
		border-radius: 2rem;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(0, 0, 0, 0.3);
		backdrop-filter: blur(12px);
		font-size: 0.9rem;
	}

	.chip.bad {
		border-color: #e66767;
		color: #ff9a9a;
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
		gap: 1rem;
		align-items: start;
	}

	.stepper {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin: 0.4rem 0 0.8rem;
	}

	.step {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.08);
		color: inherit;
		cursor: pointer;
	}

	.stepper.small .step {
		width: 2.4rem;
		height: 2.4rem;
	}

	.value {
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1;
	}

	.big {
		font-size: 2.6rem;
		font-weight: 300;
		font-variant-numeric: tabular-nums;
	}

	.stepper.small .big {
		font-size: 2rem;
	}

	.unit {
		font-size: 0.9rem;
		opacity: 0.7;
	}

	.value small {
		margin-top: 0.3rem;
		opacity: 0.6;
		font-size: 0.75rem;
	}

	.modes {
		width: 100%;
		justify-content: center;
	}

	.modes button {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.flow {
		margin: 0.7rem 0 0;
		font-size: 0.9rem;
	}

	.big-line {
		margin: 0.2rem 0 0.6rem;
		font-size: 1.4rem;
		font-weight: 300;
	}

	.small {
		font-size: 0.82rem;
		margin: 0;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(7rem + env(safe-area-inset-bottom));
		}
	}
</style>
