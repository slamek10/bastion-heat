<script lang="ts">
	import { ask, question, saveSettings, settings, t, toast } from '$lib/stores';
	import type { Room, Settings, SystemEntities } from '$lib/types';
	import type { Key } from '$lib/i18n';
	import MultiSelect from '$lib/components/MultiSelect.svelte';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let { onclose }: { onclose: () => void } = $props();

	const TABS: { id: string; icon: string; title: Key; hint: Key }[] = [
		{ id: 'rooms', icon: 'mdi:home-thermometer-outline', title: 'tab_rooms', hint: 'rooms_hint' },
		{ id: 'system', icon: 'mdi:radiator', title: 'system', hint: 'set_system_hint' },
		{ id: 'alerts', icon: 'mdi:alert-outline', title: 'set_alerts', hint: 'set_alerts_hint' },
		{
			id: 'energy',
			icon: 'mdi:lightning-bolt-outline',
			title: 'set_energy',
			hint: 'set_energy_hint'
		},
		{
			id: 'notifications',
			icon: 'mdi:bell-outline',
			title: 'notifications',
			hint: 'set_notifications_hint'
		},
		{
			id: 'appearance',
			icon: 'mdi:palette-outline',
			title: 'appearance',
			hint: 'set_appearance_hint'
		}
	];
	let activeTab = $state('rooms');
	let active = $derived(TABS.find((tab) => tab.id === activeTab) ?? TABS[0]);

	interface Entity {
		id: string;
		name: string;
		unit?: string;
		deviceClass?: string;
	}
	let entities = $state<Entity[]>([]);
	let themes = $state<string[]>([]);
	let services = $state<string[] | undefined>();

	onMount(() => {
		document.body.style.overflow = 'hidden';
		Promise.all(
			['/_api/ha/entities', '/_api/themes', '/_api/ha/notify'].map((url) =>
				fetch(url)
					.then((response) => (response.ok ? response.json() : []))
					.catch(() => [])
			)
		).then(([list, themeList, serviceList]) => {
			entities = list;
			themes = themeList;
			services = serviceList;
		});
		return () => {
			document.body.style.overflow = '';
		};
	});

	const domain = (id: string) => id.split('.')[0];
	const items = (filter: (entity: Entity) => boolean) =>
		entities
			.filter(filter)
			.map((entity) => ({ value: entity.id, label: `${entity.name} · ${entity.id}` }));
	const temperatureLike = (e: Entity) =>
		domain(e.id) === 'climate' || e.deviceClass === 'temperature' || e.unit === '°C';
	const climates = (e: Entity) => domain(e.id) === 'climate';
	const windowsLike = (e: Entity) => domain(e.id) === 'binary_sensor';
	const humidityLike = (e: Entity) =>
		e.deviceClass === 'humidity' || (domain(e.id) === 'sensor' && e.unit === '%');
	const co2Like = (e: Entity) =>
		e.deviceClass === 'carbon_dioxide' || (domain(e.id) === 'sensor' && e.unit === 'ppm');
	const outdoorHumidityLike = (e: Entity) => humidityLike(e) || domain(e.id) === 'weather';

	/** a number field saves when it's left, within its limits */
	const energyLike = (e: Entity) =>
		e.deviceClass === 'energy' || e.unit === 'kWh' || e.unit === 'Wh' || e.unit === 'MWh';

	function setNumber(
		key: 'humidityLimit' | 'co2Limit' | 'frostLimit' | 'energyPrice' | 'hddBase',
		value: string
	) {
		const number = Number(value.replace(',', '.'));
		if (value.trim() && Number.isFinite(number)) set({ [key]: number });
	}

	const set = (patch: Partial<Settings>) => saveSettings(patch).catch(() => {});

	/* rooms are edited as a whole and saved with one button */
	// svelte-ignore state_referenced_locally
	let rooms = $state<Room[]>(structuredClone($settings.rooms));
	let openRoom = $state<string | undefined>();
	// svelte-ignore state_referenced_locally
	let stale = $state(String($settings.staleMinutes));
	let roomsChanged = $state(false);

	function addRoom() {
		const id = `room-${Date.now().toString(36)}`;
		rooms.push({ id, name: '', sensors: [], aggregation: 'mean', trvs: [], windows: [] });
		openRoom = id;
		roomsChanged = true;
	}

	async function removeRoom(room: Room) {
		const yes = await ask({
			title: $t('delete_room'),
			message: room.name,
			confirm: $t('delete'),
			danger: true
		});
		if (!yes) return;
		rooms = rooms.filter((entry) => entry.id !== room.id);
		roomsChanged = true;
	}

	async function saveRooms() {
		await saveSettings({
			rooms: rooms.filter((room) => room.name.trim()),
			staleMinutes: Number(stale) || 90
		}).catch(() => {});
		rooms = structuredClone($settings.rooms);
		roomsChanged = false;
		toast({ title: $t('saved'), message: '' });
	}

	/* system entities save one by one */
	const ENTITY_FIELDS: {
		key: keyof SystemEntities;
		label: Key;
		filter: (e: Entity) => boolean;
		required?: boolean;
	}[] = [
		{ key: 'zone', label: 'ent_zone', filter: climates, required: true },
		{ key: 'ac', label: 'ent_ac', filter: climates },
		{ key: 'indoor', label: 'ent_indoor', filter: temperatureLike },
		{ key: 'outdoor', label: 'ent_outdoor', filter: temperatureLike },
		{ key: 'flow', label: 'ent_flow', filter: temperatureLike },
		{ key: 'pressure', label: 'ent_pressure', filter: (e) => domain(e.id) === 'sensor' },
		{ key: 'curve', label: 'ent_curve', filter: (e) => domain(e.id) === 'sensor' },
		{ key: 'dhw', label: 'ent_dhw', filter: (e) => domain(e.id) === 'sensor' },
		{
			key: 'waterHeater',
			label: 'ent_water_heater',
			filter: (e) => domain(e.id) === 'water_heater'
		}
	];

	function setEntity(key: keyof SystemEntities, value: string) {
		const next = { ...$settings.entities, [key]: value || undefined } as SystemEntities;
		if (!value) delete next[key];
		set({ entities: next });
	}

	let sending = $state(false);
	async function test() {
		sending = true;
		const response = await fetch('/_api/ha/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ services: $settings.notifyServices })
		}).catch(() => undefined);
		const result = await response?.json().catch(() => undefined);
		sending = false;
		toast({
			title: $t(response?.ok ? 'test_ok' : 'save_failed', { count: String(result?.sent ?? 0) }),
			message: '',
			alert: !response?.ok
		});
	}
</script>

{#snippet picker(
	value: string | undefined,
	filter: (e: Entity) => boolean,
	onchange: (value: string) => void
)}
	<select value={value ?? ''} onchange={(event) => onchange(event.currentTarget.value)}>
		<option value="">{$t('ent_none')}</option>
		{#if value && !entities.some((entity) => entity.id === value)}<option {value}>{value}</option
			>{/if}
		{#each entities.filter(filter) as entity (entity.id)}
			<option value={entity.id}>{entity.name} · {entity.id}</option>
		{/each}
	</select>
{/snippet}

<svelte:window onkeydown={(e) => e.key === 'Escape' && !$question && onclose()} />

<div
	class="settings"
	role="dialog"
	aria-modal="true"
	aria-label={$t('settings')}
	in:fly={{ duration: 260, y: 24, easing: cubicOut }}
	out:fade={{ duration: 100 }}
>
	<header class="head">
		<div>
			<div class="kicker">Bastion Heat</div>
			<h1>{$t('settings')}</h1>
			<p class="subtitle">{$t('settings_subtitle')}</p>
		</div>
		<div class="head-actions">
			<button class="close" onclick={onclose} aria-label={$t('close')}
				><Icon icon="mdi:close" height="1.4rem" /></button
			>
		</div>
	</header>

	<div class="layout">
		<nav class="nav">
			{#each TABS as item (item.id)}
				<button
					class="nav-item"
					class:active={activeTab === item.id}
					onclick={() => (activeTab = item.id)}
				>
					<span class="nav-icon"><Icon icon={item.icon} height="1.15rem" /></span>
					<span>{$t(item.title)}</span>
				</button>
			{/each}
		</nav>

		<section class="content">
			{#key activeTab}
				<header class="content-head" in:fade={{ duration: 150 }}>
					<h2>{$t(active.title)}</h2>
					<p>{$t(active.hint)}</p>
					{#if activeTab !== 'rooms'}<p class="own-save">{$t('settings_saves_itself')}</p>{/if}
				</header>
			{/key}
			<div class="panel">
				{#if activeTab === 'rooms'}
					{#each rooms as room (room.id)}
						<div class="rule">
							<div class="rule-head">
								<Icon icon={room.icon || 'mdi:home-thermometer-outline'} height="1.3rem" />
								<button
									class="rule-title"
									onclick={() => (openRoom = openRoom === room.id ? undefined : room.id)}
								>
									<strong>{room.name || '…'}</strong>
									<span>{room.sensors.length} · {room.trvs.length} TRV{room.ac ? ' · AC' : ''}</span
									>
								</button>
								<button class="icon" onclick={() => removeRoom(room)} aria-label={$t('delete')}
									><Icon icon="mdi:delete-outline" height="1.15rem" /></button
								>
							</div>
							{#if openRoom === room.id}
								<div class="rule-body">
									<div class="field column">
										<span>{$t('room_name')}</span>
										<input
											class="text"
											bind:value={room.name}
											oninput={() => (roomsChanged = true)}
										/>
									</div>
									<div class="field column">
										<span>{$t('room_icon')}</span>
										<input
											class="text"
											bind:value={room.icon}
											placeholder="mdi:sofa-outline"
											oninput={() => (roomsChanged = true)}
										/>
									</div>
									<div class="field column">
										<span>{$t('room_sensors')}</span>
										<MultiSelect
											items={items(temperatureLike)}
											selected={room.sensors}
											onchange={(next) => ((room.sensors = next), (roomsChanged = true))}
											placeholder={$t('pick_entities')}
										/>
									</div>
									<div class="field column">
										<span>{$t('room_agg')}</span>
										<div class="segmented">
											{#each ['mean', 'median', 'min'] as const as method (method)}
												<button
													class:active={room.aggregation === method}
													onclick={() => ((room.aggregation = method), (roomsChanged = true))}
													>{$t(`agg_${method}`)}</button
												>
											{/each}
										</div>
									</div>
									<div class="field column">
										<span>{$t('room_trvs')}</span>
										<MultiSelect
											items={items(climates)}
											selected={room.trvs}
											onchange={(next) => ((room.trvs = next), (roomsChanged = true))}
											placeholder={$t('pick_entities')}
										/>
									</div>
									<div class="field column">
										<span>{$t('room_ac')}</span>
										{@render picker(
											room.ac,
											climates,
											(value) => ((room.ac = value || undefined), (roomsChanged = true))
										)}
									</div>
									<div class="field column">
										<span>{$t('room_windows')}</span>
										<MultiSelect
											items={items(windowsLike)}
											selected={room.windows}
											onchange={(next) => ((room.windows = next), (roomsChanged = true))}
											placeholder={$t('pick_entities')}
										/>
									</div>
									<div class="field column">
										<span>{$t('room_humidity_sensor')}</span>
										{@render picker(
											room.humidity,
											humidityLike,
											(value) => ((room.humidity = value || undefined), (roomsChanged = true))
										)}
									</div>
									<div class="field column">
										<span>{$t('room_co2_sensor')}</span>
										{@render picker(
											room.co2,
											co2Like,
											(value) => ((room.co2 = value || undefined), (roomsChanged = true))
										)}
									</div>
								</div>
							{/if}
						</div>
					{/each}
					<div class="row">
						<button class="pill" onclick={addRoom}
							><Icon icon="mdi:plus" height="1.1rem" />{$t('add_room')}</button
						>
					</div>
					<div class="field">
						<span>{$t('stale_minutes')}</span>
						<input
							class="text short"
							bind:value={stale}
							inputmode="numeric"
							oninput={() => (roomsChanged = true)}
						/>
					</div>
					<button class="pill save" disabled={!roomsChanged} onclick={saveRooms}
						>{$t('save')}</button
					>
				{:else if activeTab === 'system'}
					{#each ENTITY_FIELDS as field (field.key)}
						<div class="field column">
							<span>{$t(field.label)}</span>
							{@render picker($settings.entities[field.key], field.filter, (value) =>
								setEntity(field.key, value)
							)}
						</div>
					{/each}
				{:else if activeTab === 'alerts'}
					<label class="switch">
						<input
							type="checkbox"
							checked={$settings.airingAlerts}
							onchange={(e) => set({ airingAlerts: e.currentTarget.checked })}
						/>
						<span>{$t('airing_alerts')}</span>
					</label>
					<p class="hint">{$t('airing_alerts_hint')}</p>
					<div class="field">
						<span>{$t('humidity_limit')}</span>
						<input
							class="text short"
							value={$settings.humidityLimit}
							inputmode="numeric"
							onchange={(e) => setNumber('humidityLimit', e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<span>{$t('co2_limit')}</span>
						<input
							class="text short"
							value={$settings.co2Limit}
							inputmode="numeric"
							onchange={(e) => setNumber('co2Limit', e.currentTarget.value)}
						/>
					</div>
					<div class="field column">
						<span>{$t('ent_outdoor_humidity')}</span>
						{@render picker($settings.entities.outdoorHumidity, outdoorHumidityLike, (value) =>
							setEntity('outdoorHumidity', value)
						)}
					</div>
					<label class="switch">
						<input
							type="checkbox"
							checked={$settings.frostAlerts}
							onchange={(e) => set({ frostAlerts: e.currentTarget.checked })}
						/>
						<span>{$t('frost_alerts')}</span>
					</label>
					<p class="hint">{$t('frost_alerts_hint')}</p>
					<div class="field">
						<span>{$t('frost_limit')}</span>
						<input
							class="text short"
							value={$settings.frostLimit}
							inputmode="decimal"
							onchange={(e) => setNumber('frostLimit', e.currentTarget.value)}
						/>
					</div>
					<div class="field column">
						<span>{$t('frost_sensors')}</span>
						<MultiSelect
							items={items(temperatureLike)}
							selected={$settings.frostSensors}
							onchange={(next) => set({ frostSensors: next })}
							placeholder={$t('pick_entities')}
						/>
					</div>
				{:else if activeTab === 'energy'}
					<div class="field column">
						<span>{$t('heating_energy')}</span>
						<MultiSelect
							items={items(energyLike)}
							selected={$settings.heatingEnergy}
							onchange={(next) => set({ heatingEnergy: next })}
							placeholder={$t('pick_entities')}
						/>
						<p class="hint">{$t('heating_energy_hint')}</p>
					</div>
					<div class="field">
						<span>{$t('energy_price')}</span>
						<input
							class="text short"
							value={$settings.energyPrice}
							inputmode="decimal"
							onchange={(e) => setNumber('energyPrice', e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<span>{$t('hdd_base')}</span>
						<input
							class="text short"
							value={$settings.hddBase}
							inputmode="decimal"
							onchange={(e) => setNumber('hddBase', e.currentTarget.value)}
						/>
					</div>
					<label class="switch">
						<input
							type="checkbox"
							checked={$settings.report.enabled}
							onchange={(e) =>
								set({ report: { ...$settings.report, enabled: e.currentTarget.checked } })}
						/>
						<span>{$t('report_enabled')}</span>
					</label>
					<div class="field">
						<span>{$t('report_when')}</span>
						<select
							value={$settings.report.weekday}
							onchange={(e) =>
								set({ report: { ...$settings.report, weekday: Number(e.currentTarget.value) } })}
						>
							{#each [1, 2, 3, 4, 5, 6, 7] as weekday (weekday)}
								<option value={weekday}>{$t(`weekday_${weekday}` as Key)}</option>
							{/each}
						</select>
						<select
							value={$settings.report.hour}
							onchange={(e) =>
								set({ report: { ...$settings.report, hour: Number(e.currentTarget.value) } })}
						>
							{#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
								<option value={hour}>{String(hour).padStart(2, '0')}:00</option>
							{/each}
						</select>
					</div>
					<p class="hint">{$t('report_hint')}</p>
				{:else if activeTab === 'notifications'}
					<div class="field column">
						<span>{$t('notify_services')}</span>
						{#if services && !services.length}
							<p class="hint">{$t('no_notify_services')}</p>
						{:else}
							<MultiSelect
								items={(services ?? []).map((value) => ({ value, label: value }))}
								selected={$settings.notifyServices}
								onchange={(next) => set({ notifyServices: next })}
								placeholder={$t('notify_pick')}
							/>
						{/if}
						<button
							class="pill small"
							onclick={test}
							disabled={sending || !$settings.notifyServices.length}
						>
							<Icon icon="mdi:send-outline" height="1rem" />{$t('send_test')}
						</button>
					</div>
					<label class="switch">
						<input
							type="checkbox"
							checked={$settings.systemAlerts}
							onchange={(e) => set({ systemAlerts: e.currentTarget.checked })}
						/>
						<span>{$t('system_alerts')}</span>
					</label>
				{:else}
					<div class="field">
						<span>{$t('theme')}</span>
						<select value={$settings.theme} onchange={(e) => set({ theme: e.currentTarget.value })}>
							{#each themes as name (name)}<option value={name}>{name}</option>{/each}
						</select>
					</div>
					<div class="field">
						<span>{$t('language')}</span>
						<div class="segmented">
							<button class:active={$settings.locale === 'hr'} onclick={() => set({ locale: 'hr' })}
								>Hrvatski</button
							>
							<button class:active={$settings.locale === 'en'} onclick={() => set({ locale: 'en' })}
								>English</button
							>
						</div>
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>

<style>
	/* Bastion HA's settings page */
	.settings {
		position: fixed;
		inset: 0;
		z-index: 20001;
		display: flex;
		flex-direction: column;
		padding: 2rem 2rem 1.5rem;
		box-sizing: border-box;
		color: white;
		background-color: black;
		background-image:
			linear-gradient(rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.35)), var(--theme-background-image);
		background-size: cover;
		background-position: center;
		overflow: hidden;
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-shrink: 0;
	}

	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-size: 0.85rem;
		opacity: 0.65;
	}

	h1 {
		margin: 0.3rem 0 0.2rem;
		font-size: clamp(2rem, 4vw, 2.9rem);
		font-weight: 400;
	}

	.subtitle {
		margin: 0;
		opacity: 0.75;
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		margin-top: 2rem;
	}

	.close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.3rem;
		height: 3.3rem;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(12px);
		color: inherit;
		cursor: pointer;
	}

	.close:hover {
		background: rgba(255, 255, 255, 0.22);
	}

	.layout {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		gap: 2rem;
		flex: 1;
		min-height: 0;
		margin-top: 2rem;
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		overflow-y: auto;
		scrollbar-width: none;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.55rem 0.7rem;
		border: none;
		border-radius: 0.9rem;
		background: none;
		color: inherit;
		font-family: inherit;
		font-size: 1.02rem;
		text-align: start;
		text-decoration: none;
		opacity: 0.85;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.nav-item:hover {
		background: rgba(255, 255, 255, 0.08);
		opacity: 1;
	}

	.nav-item.active {
		background: #f6f2ee;
		color: #2a1a24;
		opacity: 1;
	}

	.nav-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
	}

	.nav-item.active .nav-icon {
		background: rgba(42, 26, 36, 0.08);
	}

	.content {
		min-height: 0;
		overflow-y: auto;
		padding: 1.4rem 1.6rem;
		border-radius: 1.6rem;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: linear-gradient(160deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
		backdrop-filter: blur(18px);
	}

	.content-head {
		margin-bottom: 1rem;
	}

	.content-head h2 {
		margin: 0 0 0.3rem;
		font-size: 1.3rem;
		font-weight: 500;
	}

	.content-head p {
		margin: 0;
		font-size: 0.92rem;
		opacity: 0.7;
	}

	.content-head .own-save {
		margin-top: 0.3rem;
		font-size: 0.8rem;
		opacity: 0.5;
	}

	.panel {
		max-width: 56rem;
	}

	@media (max-width: 900px) {
		.settings {
			padding: 1.2rem 1rem 1rem;
		}

		.head-actions {
			margin-top: 0.5rem;
		}

		.subtitle {
			display: none;
		}

		.layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
			gap: 1rem;
			margin-top: 1rem;
		}

		.nav {
			flex-direction: row;
			overflow-x: auto;
		}

		.nav-item {
			flex-shrink: 0;
			white-space: nowrap;
		}

		.content {
			padding: 1rem;
		}
	}

	.hint {
		opacity: 0.7;
		font-size: 0.88rem;
	}

	/* each setting a row with a thin line between, like Bastion HA */
	.field {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.8rem;
		margin: 0;
		padding: 0.85rem 0;
	}

	.panel > .field + .field,
	.panel > .field + .switch {
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.field.column {
		flex-direction: column;
		align-items: stretch;
		gap: 0.45rem;
	}

	.field > span:first-child {
		opacity: 0.85;
	}

	select {
		padding: 0.55rem 0.8rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(0, 0, 0, 0.2);
		color: white;
		font-family: inherit;
		font-size: 0.95rem;
		color-scheme: dark;
	}

	select option {
		color: black;
	}

	.segmented {
		display: flex;
		flex-wrap: wrap;
		padding: 0.2rem;
		gap: 0.15rem;
		border-radius: 1.4rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(0, 0, 0, 0.2);
		align-self: flex-start;
	}

	.segmented button {
		border: none;
		border-radius: 1.2rem;
		padding: 0.45rem 0.9rem;
		background: none;
		color: rgba(255, 255, 255, 0.85);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 500;
		cursor: pointer;
	}

	.segmented button.active {
		background: var(--home-card-on);
		color: #2a1a24;
	}

	.switch {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		padding: 0.85rem 0;
		cursor: pointer;
	}

	.rule {
		border-radius: 0.9rem;
		background: rgba(255, 255, 255, 0.08);
		margin-bottom: 0.5rem;
	}

	.rule-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.7rem;
	}

	.rule-title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		border: none;
		background: none;
		color: inherit;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}

	.rule-title span {
		font-size: 0.82rem;
		opacity: 0.75;
		text-transform: capitalize;
	}

	.icon {
		display: flex;
		padding: 0.35rem;
		border: none;
		border-radius: 50%;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.6rem 1.1rem;
		border-radius: 2rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.1);
		color: inherit;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
		align-self: flex-start;
	}

	.pill.small {
		padding: 0.4rem 0.9rem;
		font-size: 0.85rem;
	}

	.pill:disabled {
		opacity: 0.5;
	}
	.rule-body {
		padding: 0 0.9rem 0.8rem;
	}

	.row {
		margin: 0.6rem 0;
	}

	.save {
		margin-top: 0.6rem;
	}

	.text {
		padding: 0.55rem 0.8rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(0, 0, 0, 0.2);
		color: white;
		font-family: inherit;
		font-size: 0.95rem;
		color-scheme: dark;
	}

	.text.short {
		width: 6rem;
	}
</style>
