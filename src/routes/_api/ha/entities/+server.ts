import { json } from '@sveltejs/kit';
import { allStates } from '$lib/server/ha';

/** entities to pick from in the settings: climate, temperature and humidity sensors, windows, people, water heaters */
export function GET() {
	const wanted = (entity: { entity_id: string; attributes: Record<string, any> }) => {
		const [domain] = entity.entity_id.split('.');
		const cls = entity.attributes.device_class;
		if (['climate', 'water_heater', 'person'].includes(domain)) return true;
		if (domain === 'sensor')
			return (
				['temperature', 'humidity', 'pressure', 'power', 'energy'].includes(cls) ||
				/temp|pressure|curve|flow|hot_water|special_function/.test(entity.entity_id)
			);
		if (domain === 'binary_sensor')
			return ['window', 'door', 'opening'].includes(cls) || /window|prozor/.test(entity.entity_id);
		return false;
	};
	return json(
		allStates()
			.filter(wanted)
			.map((entity) => ({
				id: entity.entity_id,
				name: entity.attributes.friendly_name ?? entity.entity_id,
				unit: entity.attributes.unit_of_measurement,
				deviceClass: entity.attributes.device_class
			}))
			.sort((a, b) => a.id.localeCompare(b.id))
	);
}
