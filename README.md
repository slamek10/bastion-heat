# Bastion Heat

Heating with its own logic, in the Bastion family (next to [Bastion HA](https://github.com/slamek10/bastion-ha), [Bastion Cams](https://github.com/slamek10/bastion-cams) and [Bastion Watch](https://github.com/slamek10/bastion-watch)), with the same look. It runs as its own Docker stack and talks to Home Assistant; the devices stay in HA, Heat decides and calls them.

**Status: phase 1 of 5.** What works now:

- **Pregled:** Bastion HA's "Grijanje & PTV" overview: the heating circuit (target, modes, flow against the calculated flow), hot water (a boost when a `water_heater` entity offers one), the air conditioner, water pressure, presets, and the rooms.
- **Krivulja:** the heating curve with the slope, calculated and actual flow, the deviation and where the system is now.
- **Sobe:** every room's temperature combined from **several sensors** (mean, median or the lowest; sensors that stopped reporting are left out), each sensor apart, what the thermostat measures next to it, the target, heating, a window open, humidity, and 24 hours of each sensor.
- **Upozorenja:** airing advice when a room is humid and the air outside is drier (absolute humidity, so cold damp air still dries a room) or its CO₂ is high, and a cold warning when a room or an extra spot (garage, cellar) stays under the limit (10 °C) for ten minutes. On Pregled, on each room, and as phone notifications.
- **Analiza:** energy per heating degree-day (HA's long-term statistics of the outdoor temperature and the chosen kWh meters): this season against the last one up to the same day, the last 12 months, every season with cost. And the **weekly report**: per room the average, target, min/max, hours of heating and alerts; energy, cost and kWh per degree-day against the week before; tips. Sent to the phone on the set day and hour, kept for 26 weeks, or made on demand.
- **Potrošnja iz myVAILLANT-a:** with the energy source set to myVAILLANT, Heat takes Vaillant's own daily figures (the same as the app) through the myPyllant integration's `mypyllant.export` action: the whole history once, in 60-day pieces a minute apart, then the last 7 days every morning at 05:30 (Vaillant fills days in late and limits API calls). Heating gas drives the efficiency; hot water and the boiler's electricity are shown apart. No Vaillant password in Heat. `VAILLANT=off` disables it.
- **Postavke:** rooms (sensors, how to combine them, radiator valves, AC, windows, humidity, CO₂), the system's entities, alerts, energy and report, notifications, appearance.
- **Natrag:** opened from Bastion HA with `?from=<address>`, a button top left goes back there.
- Heat writes `sensor.bastion_heat_summary` to HA every minute (house average, rooms, heating), for Bastion HA's card.

| Phase | What                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 ✅  | App, the copy of the heating view, rooms from several sensors, back button                                                                                                                             |
| 2     | The brain: average-based control (valve per room, the main zone when every room is warm), weekly schedules and exceptions, windows, presence, boost, frost protection, a dry run first, a decision log |
| 3     | History and health: heat-up rates, valve activity, TRV batteries and API quota, humidity and dew point                                                                                                 |
| 4     | Energy and cost per source                                                                                                                                                                             |
| 5     | The assistant                                                                                                                                                                                          |

## Security

- Login required (`APP_PASSWORD`, `HEAT_SECRET` of 32+ characters), five wrong passwords in 15 minutes lock an address out.
- The HA token stays on the server; the page gets only the entities of the heating settings.
- The page can change only climate (temperature, mode, preset) and water heater entities that are in the heating settings; nothing else in HA can be called through Heat.
- The back button only takes `http(s)` addresses.

## Install

```sh
git clone https://github.com/slamek10/bastion-heat.git /opt/bastion-heat && cd /opt/bastion-heat
cp .env.example .env   # APP_PASSWORD, HEAT_SECRET=$(openssl rand -hex 32), HASS_URL, HASS_TOKEN, APP_URL
docker compose up -d --build
```

Interface: `http://<server>:5090`. In Bastion HA, put this address in Postavke → Početna → Bastion Heat.

## Development

```sh
npm install
npm run dev     # http://localhost:5090, reads .env (SUMMARY=off keeps it from writing to HA)
npm run check
npm test
```
