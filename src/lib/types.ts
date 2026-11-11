export type Locale = 'hr' | 'en';

/** the house's heating entities in Home Assistant */
export interface SystemEntities {
	/** the main heating zone (boiler / heat pump) */
	zone: string;
	/** air conditioning unit */
	ac?: string;
	flow?: string;
	outdoor?: string;
	pressure?: string;
	/** heating curve slope */
	curve?: string;
	/** hot water state */
	dhw?: string;
	/** a water_heater entity, when there is one: hot water boost through it */
	waterHeater?: string;
	/** the temperature the main thermostat measures */
	indoor?: string;
}

export type Aggregation = 'mean' | 'median' | 'min';

export interface Room {
	id: string;
	name: string;
	icon?: string;
	/** temperature sensors and climate entities (their current_temperature), combined */
	sensors: string[];
	aggregation: Aggregation;
	/** radiator valves (climate) in this room */
	trvs: string[];
	/** an air conditioner that may heat this room */
	ac?: string;
	/** window / door contacts and TRV window_open sensors */
	windows: string[];
	humidity?: string;
	/** the user's own names for the room's sensors and valves, by entity */
	labels?: Record<string, string>;
}

export interface PresetTarget {
	entity_id: string;
	temperature?: number;
	hvac_mode?: string;
}

export interface Preset {
	id: string;
	name: string;
	icon?: string;
	targets: PresetTarget[];
}

export interface Settings {
	locale: Locale;
	theme: string;
	notifyServices: string[];
	systemAlerts: boolean;
	entities: SystemEntities;
	rooms: Room[];
	presets: Preset[];
	/** a sensor older than this many minutes is left out of a room's temperature */
	staleMinutes: number;
}

/** defaults from Bastion HA's heating card, so the first start shows the same house */
export const DEFAULT_SETTINGS: Settings = {
	locale: 'hr',
	theme: 'adaptive-ember',
	notifyServices: [],
	systemAlerts: true,
	entities: {
		zone: 'climate.slameks_residence_zone_1_circuit_0_climate',
		ac: 'climate.slamek_melcloudhome_eed5_1ccc_climate',
		flow: 'sensor.slameks_residence_circuit_0_current_flow_temperature',
		outdoor: 'sensor.slameks_residence_outdoor_temperature',
		pressure: 'sensor.slameks_residence_system_water_pressure',
		curve: 'sensor.slameks_residence_circuit_0_heating_curve',
		dhw: 'sensor.slameks_residence_domestic_hot_water_0_current_special_function',
		indoor: 'sensor.slameks_residence_zone_1_circuit_0_current_temperature'
	},
	rooms: [
		{
			id: 'living',
			name: 'Dnevni boravak',
			icon: 'mdi:sofa-outline',
			sensors: ['sensor.slameks_residence_zone_1_circuit_0_current_temperature'],
			aggregation: 'mean',
			trvs: [],
			windows: []
		},
		{
			id: 'bedroom',
			name: 'Soba',
			icon: 'mdi:bed-outline',
			sensors: ['sensor.senzor_soba_temperature'],
			aggregation: 'mean',
			trvs: [],
			windows: []
		},
		{
			id: 'office',
			name: 'Ured',
			icon: 'mdi:desk',
			sensors: ['sensor.senzor_ured_temperature'],
			aggregation: 'mean',
			trvs: [],
			windows: []
		}
	],
	presets: [],
	staleMinutes: 90
};

/** an entity as Home Assistant reports it */
export interface HaState {
	entity_id: string;
	state: string;
	attributes: Record<string, any>;
	last_changed?: string;
	last_updated?: string;
	/** HA 2024.3+: also set when a sensor reports the same value again */
	last_reported?: string;
}

export interface SensorReading {
	entity: string;
	value?: number;
	/** too old, unavailable or not a number: left out */
	stale: boolean;
}

export interface RoomReading {
	roomId: string;
	/** the room's temperature from its sensors, combined */
	value?: number;
	used: SensorReading[];
	/** what the room's thermostat(s) measure, to compare */
	thermostat?: number;
	/** the target its valves (or the main zone) are set to */
	target?: number;
	/** a valve or the main zone is heating it right now */
	heating: boolean;
	humidity?: number;
	windowOpen: boolean;
}

export interface Status {
	ha: boolean;
}

export type LiveMessage =
	| { kind: 'status'; status: Status }
	| { kind: 'states'; states: Record<string, HaState> }
	| { kind: 'notice'; title: string; message: string; alert?: boolean };
