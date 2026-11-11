import { json } from '@sveltejs/kit';
import { sendNotification } from '$lib/server/notify';
import { loadSettings } from '$lib/server/store';
import { translate } from '$lib/i18n';

export async function POST({ request }) {
	const { services } = await request.json().catch(() => ({}));
	const settings = await loadSettings();
	const list: string[] =
		Array.isArray(services) && services.length ? services : settings.notifyServices;
	const sent = await sendNotification(list, {
		title: translate(settings.locale, 'app_name'),
		message: translate(settings.locale, 'test_sent'),
		tag: 'bastion-heat-test'
	});
	return json({ sent, of: list.length }, { status: sent ? 200 : 502 });
}
