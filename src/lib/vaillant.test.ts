import { describe, expect, it } from 'vitest';
import { parseExport } from './vaillant';

const series = (mode: string, type: string, values: number[]) => ({
	operation_mode: mode,
	resolution: 'DAY',
	energy_type: type,
	data: values.map((value, i) => ({
		start_date: `2026-11-0${i + 1}T01:00:00+01:00`,
		end_date: `2026-11-0${i + 2}T01:00:00+01:00`,
		value
	}))
});

describe('parseExport', () => {
	it('reads the myPyllant export: gas for heating and hot water, electricity, heat', () => {
		const result = parseExport({
			export: [
				{
					device: { first_data: '2025-09-26T23:53:41.835000+02:00', device_type: 'BOILER' },
					data: [
						series('DOMESTIC_HOT_WATER', 'CONSUMED_ELECTRICAL_ENERGY', [47.609375, 34.1]),
						series('HEATING', 'CONSUMED_ELECTRICAL_ENERGY', [431.07, 402.95]),
						series('DOMESTIC_HOT_WATER', 'CONSUMED_PRIMARY_ENERGY', [9144, 9586]),
						series('HEATING', 'CONSUMED_PRIMARY_ENERGY', [70416, 69048]),
						series('DOMESTIC_HOT_WATER', 'HEAT_GENERATED', [8694, 9266]),
						series('HEATING', 'HEAT_GENERATED', [69960, 68980])
					]
				}
			]
		});
		expect(result.firstData).toBe('2025-09-26');
		expect(result.days['2026-11-01']).toEqual({
			heating: 70.416,
			dhw: 9.144,
			electric: 0.479,
			generated: 78.654
		});
		expect(result.days['2026-11-02'].heating).toBe(69.048);
	});

	it('ignores what it does not know', () => {
		expect(parseExport(null)).toEqual({ days: {}, firstData: undefined });
		expect(
			parseExport({ export: [{ data: [{ ...series('HEATING', 'OTHER', [1]) }] }] }).days
		).toEqual({});
	});
});
