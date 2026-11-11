/**
 * Vaillant's own energy figures (what the myVAILLANT app shows), from the
 * myPyllant integration's `mypyllant.export` action: per device, per
 * operation mode (heating, hot water) and energy type, buckets of Wh.
 */

export interface VaillantDay {
	/** gas (primary energy) for heating, kWh */
	heating: number;
	/** gas for hot water, kWh */
	dhw: number;
	/** the boiler's own electricity, kWh */
	electric: number;
	/** heat delivered (heating + hot water), kWh */
	generated: number;
}

interface Bucket {
	start_date?: string;
	value?: number | null;
}
interface Series {
	operation_mode?: string;
	energy_type?: string;
	resolution?: string;
	data?: Bucket[];
}
interface Entry {
	device?: { first_data?: string };
	data?: Series[];
}

const FIELD: Record<string, (mode: string) => keyof VaillantDay | undefined> = {
	CONSUMED_PRIMARY_ENERGY: (mode) =>
		mode === 'HEATING' ? 'heating' : mode === 'DOMESTIC_HOT_WATER' ? 'dhw' : undefined,
	CONSUMED_ELECTRICAL_ENERGY: () => 'electric',
	HEAT_GENERATED: () => 'generated'
};

const empty = (): VaillantDay => ({ heating: 0, dhw: 0, electric: 0, generated: 0 });

/**
 * Days from an export response; the bucket's date is the local date in its
 * start (Vaillant writes it with the house's offset). Several devices add up.
 */
export function parseExport(response: unknown) {
	const list: Entry[] = Array.isArray((response as { export?: unknown })?.export)
		? (response as { export: Entry[] }).export
		: [];
	const days: Record<string, VaillantDay> = {};
	let firstData: string | undefined;
	for (const entry of list) {
		const first = entry.device?.first_data;
		if (first && (!firstData || first < firstData)) firstData = first;
		for (const series of entry.data ?? []) {
			if (series.resolution && series.resolution !== 'DAY') continue;
			const field = FIELD[series.energy_type ?? '']?.(series.operation_mode ?? '');
			if (!field) continue;
			for (const bucket of series.data ?? []) {
				const date = bucket.start_date?.slice(0, 10);
				if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof bucket.value !== 'number')
					continue;
				const day = (days[date] ??= empty());
				day[field] = Math.round((day[field] + bucket.value / 1000) * 1000) / 1000;
			}
		}
	}
	return { days, firstData: firstData?.slice(0, 10) };
}
