import { json } from '@sveltejs/kit';
import { callService } from '$lib/server/ha';
import { loadSettings } from '$lib/server/store';
import { controllable } from '$lib/server/heat';

const SERVICES: Record<string, string[]> = {
	climate: ['set_temperature', 'set_hvac_mode', 'set_preset_mode'],
	water_heater: ['set_operation_mode', 'set_temperature']
};

/**
 * The page's buttons: only climate and water heater changes, only on
 * entities of the heating settings. Nothing else in HA can be called.
 */
export async function POST({ request }) {
	const { domain, service, data } = await request.json().catch(() => ({}));
	const entity = typeof data?.entity_id === 'string' ? data.entity_id : '';
	const settings = await loadSettings();
	const allowed = controllable(settings);
	if (settings.entities.waterHeater) allowed.add(settings.entities.waterHeater);
	if (
		!SERVICES[domain]?.includes(service) ||
		!entity.startsWith(`${domain}.`) ||
		!allowed.has(entity)
	) {
		return json({ error: 'not allowed' }, { status: 403 });
	}
	const clean: Record<string, unknown> = { entity_id: entity };
	if (Number.isFinite(Number(data.temperature))) clean.temperature = Number(data.temperature);
	for (const key of ['hvac_mode', 'preset_mode', 'operation_mode']) {
		if (typeof data[key] === 'string' && /^[\w-]{1,30}$/.test(data[key])) clean[key] = data[key];
	}
	try {
		await callService(domain, service, clean);
		return json({ ok: true });
	} catch (error) {
		return json({ error: (error as Error).message.slice(0, 200) }, { status: 502 });
	}
}
