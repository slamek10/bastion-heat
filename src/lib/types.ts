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
	/** outdoor humidity: a sensor, or a weather entity (its humidity and temperature) */
	outdoorHumidity?: string;
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
	/** a CO₂ sensor (ppm), for airing advice */
	co2?: string;
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
	/** advice to air a room that is too humid (when outside is drier) or has high CO₂ */
	airingAlerts: boolean;
	/** % relative humidity */
	humidityLimit: number;
	/** ppm */
	co2Limit: number;
	/** a warning when a room or a spot below falls under frostLimit */
	frostAlerts: boolean;
	/** °C */
	frostLimit: number;
	/** spots that aren't rooms but must not freeze: a garage, a cellar, the boiler room */
	frostSensors: string[];
	/** kWh meters of the heating (heat pump / boiler; gas in kWh) */
	heatingEnergy: string[];
	/** €/kWh, 0 = no cost shown */
	energyPrice: number;
	/** °C the house is heated to, for degree-days */
	hddBase: number;
	/** the weekly report: day (1 = Monday … 7 = Sunday) and hour */
	report: { enabled: boolean; weekday: number; hour: number };
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
	staleMinutes: 90,
	airingAlerts: true,
	humidityLimit: 60,
	co2Limit: 1000,
	frostAlerts: true,
	frostLimit: 10,
	frostSensors: [],
	heatingEnergy: [],
	energyPrice: 0,
	hddBase: 18,
	report: { enabled: true, weekday: 1, hour: 8 }
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

export interface Alert {
	key: string;
	kind: 'airing' | 'cold';
	/** the room's name or the spot's */
	name: string;
	/** i18n key and its values */
	message: string;
	vars: Record<string, string>;
	since: number;
}

export type LiveMessage =
	| { kind: 'alerts'; alerts: Alert[] }
	| { kind: 'status'; status: Status }
	| { kind: 'states'; states: Record<string, HaState> }
	| { kind: 'notice'; title: string; message: string; alert?: boolean };
