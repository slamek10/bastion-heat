/**
 * Notifications to the Home Assistant mobile app, like Bastion Cams
 */
import { config } from '$lib/server/env';
import { setStatus } from '$lib/server/bus';

export interface Notification {
	title: string;
	message: string;
	/** a later notification with the same tag replaces this one on the phone */
	tag?: string;
	urgent?: boolean;
	/** buttons on the notification; a press comes back through phoneActions.ts */
	actions?: { action: string; title: string }[];
}

export async function ha(path: string, init?: RequestInit) {
	if (!config.hassUrl || !config.hassToken) throw new Error('HASS_URL / HASS_TOKEN not set');
	const response = await fetch(`${config.hassUrl}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${config.hassToken}`,
			'Content-Type': 'application/json',
			...init?.headers
		},
		signal: AbortSignal.timeout(10000)
	});
	setStatus({ ha: response.ok });
	if (!response.ok) throw new Error(`HA ${path}: ${response.status}`);
	return response;
}

/** names of HA's notify services, e.g. mobile_app_iphone */
export async function notifyServices(): Promise<string[]> {
	try {
		const domains: { domain: string; services: Record<string, unknown> }[] = await (
			await ha('/api/services')
		).json();
		const notify = domains.find((entry) => entry.domain === 'notify');
		return Object.keys(notify?.services ?? {})
			.filter((name) => name !== 'send_message' && name !== 'persistent_notification')
			.sort();
	} catch (error) {
		setStatus({ ha: false });
		console.warn('[notify] services:', (error as Error).message);
		return [];
	}
}

export async function sendNotification(services: string[], notification: Notification) {
	const link = config.publicUrl ? `${config.publicUrl}/` : undefined;
	const data: Record<string, unknown> = {
		...(notification.actions?.length && { actions: notification.actions }),
		tag: notification.tag,
		group: 'bastion-heat',
		...(link && { url: link, clickAction: link }),
		...(notification.urgent && {
			push: { 'interruption-level': 'time-sensitive' },
			priority: 'high',
			ttl: 0
		})
	};
	const results = await Promise.allSettled(
		services.map((service) =>
			ha(`/api/services/notify/${service.replace(/^notify\./, '')}`, {
				method: 'POST',
				body: JSON.stringify({ title: notification.title, message: notification.message, data })
			})
		)
	);
	for (const result of results) {
		if (result.status === 'rejected') console.warn('[notify]', result.reason?.message);
	}
	return results.filter((result) => result.status === 'fulfilled').length;
}
