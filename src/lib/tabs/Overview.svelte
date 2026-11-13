<script lang="ts">
	/**
	 * Bastion HA's "Grijanje & PTV" overview: the heating circuit, hot water,
	 * the AC, water pressure and presets, plus the rooms with their combined
	 * temperatures. Changes go through /_api/ha/call.
	 *
	 * The cards sit in panels (Centralno grijanje, Voda i tlak, Sobe, or the
	 * user's own) or on their own; in edit mode a handle drags a card or a
	 * whole panel anywhere (pointer events, so a finger works too).
	 */
	import {
		ago,
		alerts,
		brain,
		call,
		diagnostics,
		editMode,
		followDiagnostics,
		house,
		now,
		rooms,
		saveSettings,
		settings,
		states,
		status,
		t
	} from '$lib/stores';
	import type { AlertKind, OverviewBlock } from '$lib/types';
	import { onMount } from 'svelte';
	import type { Key } from '$lib/i18n';
	import { numberOf } from '$lib/rooms';
	import { pressureState, targetFlow } from '$lib/curve';
	import { arrange, isGroup, moveGroup, moveItem, removeGroup, type Target } from '$lib/overview';
	import { followRoomHistory } from '$lib/roomHistory.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import RoomCard from '$lib/components/RoomCard.svelte';
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
	onMount(followRoomHistory);

	/* ---- the layout ---- */

	let roomById = $derived(new Map($rooms.map((entry) => [entry.room.id, entry])));
	let blocks = $derived(
		arrange(
			$settings.overview,
			$settings.rooms.map((room) => room.id)
		)
	);

	/** a card shows only when its entity is there */
	function shown(id: string) {
		switch (id) {
			case 'zone':
				return !!zone;
			case 'ac':
				return !!(ac && e.ac);
			case 'dhw':
				return !!(dhw || waterHeater);
			case 'pressure':
				return pressure !== undefined;
			case 'valves':
				return !!($diagnostics && ($diagnostics.valves.length || $diagnostics.quota));
			case 'brain':
				return !!$brain;
			default:
				return id.startsWith('room:') && roomById.has(id.slice(5));
		}
	}

	const ITEM_TITLES: Record<string, Key> = {
		zone: 'circuit_title',
		ac: 'ac_title',
		dhw: 'dhw_title',
		pressure: 'pressure_title',
		valves: 'health_title',
		brain: 'brain_title'
	};
	const itemTitle = (id: string) =>
		id.startsWith('room:')
			? (roomById.get(id.slice(5))?.room.name ?? id)
			: $t(ITEM_TITLES[id] ?? 'panel_new');

	const GROUPS: Record<string, { key: Key; icon: string }> = {
		central: { key: 'panel_central', icon: 'mdi:water-boiler' },
		water: { key: 'panel_water', icon: 'mdi:water-outline' },
		rooms: { key: 'rooms_title', icon: 'mdi:home-outline' }
	};
	const groupTitle = (block: { group: string; title?: string }) =>
		block.title || $t(GROUPS[block.group]?.key ?? 'panel_new');

	/** loose cards next to each other share one grid; a panel takes the whole width */
	type Row =
		| { group: Extract<OverviewBlock, { group: string }>; index: number }
		| { loose: { id: string; index: number }[] };
	let rows = $derived.by(() => {
		const out: Row[] = [];
		blocks.forEach((block, index) => {
			if (isGroup(block)) {
				if ($editMode || block.items.some(shown)) out.push({ group: block, index });
				return;
			}
			if (!shown(block.item)) return;
			const last = out.at(-1);
			if (last && 'loose' in last) last.loose.push({ id: block.item, index });
			else out.push({ loose: [{ id: block.item, index }] });
		});
		return out;
	});

	const store = (next: OverviewBlock[]) => saveSettings({ overview: next }).catch(() => {});

	function addGroup() {
		store([{ group: `p${Date.now().toString(36)}`, title: $t('panel_new'), items: [] }, ...blocks]);
	}

	const renameGroup = (group: string, title: string) =>
		store(
			blocks.map((block) =>
				isGroup(block) && block.group === group
					? { ...block, title: title.trim().slice(0, 40) || undefined }
					: block
			)
		);

	/* ---- drag & drop ---- */

	type Drag = { item: string } | { group: string };
	/** what is dragged, where the pointer is, and where it would land */
	let drag = $state<(Drag & { x: number; y: number; label: string }) | undefined>();
	let drop = $state<{
		target: Target;
		key: string;
		side: 'left' | 'right' | 'top' | 'bottom' | 'in';
	}>();
	let scroller: ReturnType<typeof setInterval> | undefined;

	function start(event: PointerEvent, what: Drag) {
		if (event.button !== 0) return;
		event.preventDefault();
		drag = {
			...what,
			x: event.clientX,
			y: event.clientY,
			label:
				'item' in what
					? itemTitle(what.item)
					: groupTitle(
							blocks.find((b) => isGroup(b) && b.group === what.group) as { group: string }
						)
		};
		drop = undefined;
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', cancel);
		// near the top or bottom edge the page scrolls by itself
		scroller = setInterval(() => {
			if (!drag) return;
			if (drag.y < 70) window.scrollBy(0, -14);
			else if (drag.y > innerHeight - 70) window.scrollBy(0, 14);
		}, 16);
	}

	function move(event: PointerEvent) {
		if (!drag) return;
		drag.x = event.clientX;
		drag.y = event.clientY;
		drop = targetAt(event.clientX, event.clientY);
	}

	/** the top-level place by height: before the first block whose middle is below the pointer */
	function topAt(y: number): typeof drop {
		const all = [...document.querySelectorAll<HTMLElement>('[data-block]')];
		const hit = all.find((el) => {
			const r = el.getBoundingClientRect();
			return y < r.top + r.height / 2;
		});
		if (hit)
			return { target: { top: Number(hit.dataset.block) }, key: hit.dataset.key!, side: 'top' };
		const last = all.at(-1);
		return last
			? { target: { top: blocks.length }, key: last.dataset.key!, side: 'bottom' }
			: undefined;
	}

	function targetAt(x: number, y: number): typeof drop {
		if (!drag) return;
		const el = document.elementFromPoint(x, y);
		if (!el?.closest('[data-layout]')) return;
		if ('item' in drag) {
			const slot = el.closest<HTMLElement>('[data-item]');
			if (slot) {
				if (slot.dataset.item === drag.item) return;
				const r = slot.getBoundingClientRect();
				const after = x > r.left + r.width / 2;
				const index = Number(slot.dataset.index) + (after ? 1 : 0);
				const inside = slot.dataset.in;
				return {
					target: inside ? { group: inside, index } : { top: index },
					key: slot.dataset.key!,
					side: after ? 'right' : 'left'
				};
			}
			const group = el.closest<HTMLElement>('[data-group]');
			if (group) {
				const id = group.dataset.group!;
				const block = blocks.find((b) => isGroup(b) && b.group === id);
				const index = block && isGroup(block) ? block.items.length : 0;
				return { target: { group: id, index }, key: group.dataset.key!, side: 'in' };
			}
		}
		return topAt(y);
	}

	function stop() {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', end);
		window.removeEventListener('pointercancel', cancel);
		clearInterval(scroller);
		drag = undefined;
		drop = undefined;
	}

	function end() {
		if (drag && drop) {
			if ('item' in drag) store(moveItem(blocks, drag.item, drop.target));
			else if ('top' in drop.target) store(moveGroup(blocks, drag.group, drop.target.top));
		}
		stop();
	}

	const cancel = () => stop();

	$effect(() => {
		if (!$editMode && drag) stop();
	});
	onMount(() => stop);

	const markOf = (key: string) => (drop?.key === key ? drop.side : undefined);

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

	{#snippet card(id: string)}
		{#if id === 'zone' && zone}
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
		{:else if id === 'dhw' && (dhw || waterHeater)}
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
		{:else if id === 'ac' && ac && e.ac}
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
		{:else if id === 'pressure' && pressure !== undefined}
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
		{:else if id === 'valves' && $diagnostics && ($diagnostics.valves.length || $diagnostics.quota)}
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
		{:else if id === 'brain' && $brain}
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
		{:else if id.startsWith('room:') && roomById.has(id.slice(5))}
			{@const entry = roomById.get(id.slice(5))!}
			<RoomCard room={entry.room} reading={entry.reading} />
		{/if}
	{/snippet}

	{#snippet slot(id: string, inside: string, index: number)}
		<div
			class="slot"
			class:lifted={drag && 'item' in drag && drag.item === id}
			data-item={id}
			data-in={inside}
			data-index={index}
			data-key="item:{id}"
			data-block={inside ? undefined : index}
			data-mark={markOf(`item:${id}`)}
		>
			{#if $editMode}
				<button
					class="handle"
					onpointerdown={(event) => start(event, { item: id })}
					aria-label="{$t('panel_drag')}: {itemTitle(id)}"
					title={$t('panel_drag')}
				>
					<Icon icon="mdi:drag" height="1.2rem" />
				</button>
			{/if}
			{@render card(id)}
		</div>
	{/snippet}

	{#if $editMode}
		<div class="layout-tools">
			<button class="w-pill" onclick={addGroup}>
				<Icon icon="mdi:plus" height="1rem" />{$t('panel_add')}
			</button>
			<button class="w-pill" onclick={() => store([])}>
				<Icon icon="mdi:restore" height="1rem" />{$t('layout_reset')}
			</button>
			<span class="w-dim small">{$t('layout_hint')}</span>
		</div>
	{/if}

	<div class="layout" data-layout>
		{#each rows as row ('group' in row ? `g:${row.group.group}` : `l:${row.loose[0].id}`)}
			{#if 'group' in row}
				{@const group = row.group}
				<section
					class="w-card group"
					class:lifted={drag && 'group' in drag && drag.group === group.group}
					data-group={group.group}
					data-block={row.index}
					data-key="group:{group.group}"
					data-mark={markOf(`group:${group.group}`)}
				>
					<h3>
						{#if $editMode}
							<button
								class="handle inline"
								onpointerdown={(event) => start(event, { group: group.group })}
								aria-label="{$t('panel_drag')}: {groupTitle(group)}"
								title={$t('panel_drag')}
							>
								<Icon icon="mdi:drag" height="1.2rem" />
							</button>
							<input
								class="group-name"
								value={groupTitle(group)}
								maxlength="40"
								aria-label={$t('panel_name')}
								onchange={(event) => renameGroup(group.group, event.currentTarget.value)}
								onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
							/>
							<button
								class="remove"
								onclick={() => store(removeGroup(blocks, group.group))}
								aria-label={$t('panel_remove')}
								title={$t('panel_remove')}
							>
								<Icon icon="mdi:trash-can-outline" height="1.1rem" />
							</button>
						{:else}
							<Icon icon={GROUPS[group.group]?.icon ?? 'mdi:view-grid-outline'} height="1.15rem" />
							<span>{groupTitle(group)}</span>
						{/if}
					</h3>
					<div class="cards">
						{#each group.items as id, index (id)}
							{#if shown(id)}{@render slot(id, group.group, index)}{/if}
						{/each}
					</div>
					{#if $editMode && !group.items.some(shown)}
						<p class="empty w-dim">{$t('panel_empty')}</p>
					{/if}
				</section>
			{:else}
				<div class="cards loose">
					{#each row.loose as item (item.id)}
						{@render slot(item.id, '', item.index)}
					{/each}
				</div>
			{/if}
		{/each}
	</div>

	{#if !$rooms.length}
		<p class="w-card">{$t('no_rooms')}</p>
	{/if}

	{#if drag}
		<div class="ghost" style:left="{drag.x}px" style:top="{drag.y}px">
			<Icon icon="mdi:drag" height="1rem" />{drag.label}
		</div>
	{/if}
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

	.layout {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: 0.8rem;
		align-items: start;
	}

	.cards.loose {
		gap: 1rem;
	}

	/* a panel's own cards: lighter, so the panel reads as one thing */
	.group {
		padding: 0.9rem;
	}

	.group > h3 {
		padding: 0 0.2rem;
	}

	.group :global(.w-card) {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(255, 255, 255, 0.09);
		backdrop-filter: none;
		border-radius: 1rem;
	}

	.slot {
		position: relative;
		min-width: 0;
		display: grid;
	}

	.lifted {
		opacity: 0.35;
	}

	/* where a dragged card or panel would land */
	[data-mark='left']::before,
	[data-mark='right']::before,
	[data-mark='top']::before,
	[data-mark='bottom']::before {
		content: '';
		position: absolute;
		z-index: 3;
		border-radius: 2px;
		background: #7fb4f0;
		box-shadow: 0 0 10px #3987e5;
		pointer-events: none;
	}

	[data-mark='left']::before,
	[data-mark='right']::before {
		top: 0;
		bottom: 0;
		width: 4px;
	}

	[data-mark='left']::before {
		left: -0.55rem;
	}

	[data-mark='right']::before {
		right: -0.55rem;
	}

	[data-mark='top']::before,
	[data-mark='bottom']::before {
		left: 0;
		right: 0;
		height: 4px;
	}

	[data-mark='top']::before {
		top: -0.6rem;
	}

	[data-mark='bottom']::before {
		bottom: -0.6rem;
	}

	.group {
		position: relative;
	}

	.group[data-mark='in'] {
		border-color: #7fb4f0;
		box-shadow: 0 0 0 1px #7fb4f0 inset;
	}

	.handle {
		position: absolute;
		z-index: 2;
		top: -0.55rem;
		left: -0.55rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.3);
		background: #3987e5;
		color: white;
		cursor: grab;
		touch-action: none;
	}

	.handle.inline {
		position: static;
		flex: none;
	}

	.group-name {
		flex: 1;
		min-width: 0;
		padding: 0.3rem 0.6rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.3);
		background: rgba(0, 0, 0, 0.3);
		color: white;
		font: inherit;
	}

	.remove {
		display: flex;
		padding: 0.35rem;
		border: none;
		border-radius: 50%;
		background: none;
		color: inherit;
		opacity: 0.7;
		cursor: pointer;
	}

	.remove:hover {
		opacity: 1;
		background: rgba(224, 49, 47, 0.3);
	}

	.empty {
		margin: 0;
		padding: 1.4rem;
		border: 1px dashed rgba(255, 255, 255, 0.25);
		border-radius: 1rem;
		text-align: center;
		font-size: 0.88rem;
	}

	.layout-tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.8rem;
		margin-bottom: 1rem;
	}

	.ghost {
		position: fixed;
		z-index: 50;
		transform: translate(0.8rem, 0.8rem);
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.85rem;
		border-radius: 2rem;
		background: #3987e5;
		color: white;
		font-size: 0.9rem;
		pointer-events: none;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
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

		.cards {
			grid-template-columns: minmax(0, 1fr);
		}

		.group {
			padding: 0.7rem;
		}
	}
</style>
