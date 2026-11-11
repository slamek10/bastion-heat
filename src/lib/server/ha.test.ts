import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';

let server: WebSocketServer;
const calls: any[] = [];
let token = 'good';

beforeAll(async () => {
	server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
	await new Promise<void>((resolve) => server.on('listening', () => resolve()));
	server.on('connection', (socket) => {
		socket.send(JSON.stringify({ type: 'auth_required' }));
		socket.on('message', (raw) => {
			const message = JSON.parse(String(raw));
			if (message.type === 'auth') {
				socket.send(
					JSON.stringify({ type: message.access_token === token ? 'auth_ok' : 'auth_invalid' })
				);
				return;
			}
			const reply = (result: unknown) =>
				socket.send(JSON.stringify({ id: message.id, type: 'result', success: true, result }));
			if (message.type === 'get_states') {
				reply([
					{
						entity_id: 'climate.zone',
						state: 'heat',
						attributes: { temperature: 22, current_temperature: 21.4 }
					},
					{ entity_id: 'sensor.soba', state: '21.0', attributes: {} },
					{ entity_id: 'sensor.other', state: '5', attributes: {} }
				]);
			} else if (message.type === 'subscribe_events') {
				reply(null);
				setTimeout(() => {
					socket.send(
						JSON.stringify({
							id: message.id,
							type: 'event',
							event: {
								event_type: 'state_changed',
								data: {
									entity_id: 'sensor.soba',
									new_state: { entity_id: 'sensor.soba', state: '21.6', attributes: {} }
								}
							}
						})
					);
				}, 50);
			} else if (message.type === 'call_service') {
				calls.push(message);
				reply({});
			}
		});
	});
	process.env.HASS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	process.env.HASS_TOKEN = token;
});
afterAll(async () => {
	process.env.HASS_URL = '';
	for (const client of server.clients) client.terminate();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

const until = async (check: () => boolean, ms = 3000) => {
	const end = Date.now() + ms;
	while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
	return check();
};

describe('Home Assistant over the websocket', () => {
	it('logs in, keeps states, publishes changes of watched entities only, calls services', async () => {
		const { startHa, haReady, getState, setWatched, callService } = await import('./ha');
		const { subscribe } = await import('./bus');
		const published: any[] = [];
		subscribe((message) => published.push(message));
		setWatched(['climate.zone', 'sensor.soba']);
		startHa();
		expect(await until(() => haReady() && !!getState('climate.zone'))).toBe(true);
		expect(await until(() => getState('sensor.soba')?.state === '21.6')).toBe(true);
		expect(
			await until(() =>
				published.some((m) => m.kind === 'states' && m.states['sensor.soba']?.state === '21.6')
			)
		).toBe(true);
		// sensor.other isn't watched: never sent to the page
		expect(published.some((m) => m.kind === 'states' && m.states['sensor.other'])).toBe(false);
		await callService('climate', 'set_temperature', {
			entity_id: 'climate.zone',
			temperature: 21.5
		});
		expect(calls[0]).toMatchObject({
			domain: 'climate',
			service: 'set_temperature',
			service_data: { entity_id: 'climate.zone', temperature: 21.5 }
		});
	});
});
