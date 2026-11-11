import { json } from '@sveltejs/kit';
import { listReports, makeReport, saveReport } from '$lib/server/report';

export const GET = async () => json(await listReports());

let last = 0;

/** a report for the last seven days, now; once a minute at most */
export async function POST() {
	if (Date.now() - last < 60_000) return json({ error: 'wait a minute' }, { status: 429 });
	last = Date.now();
	try {
		const report = await makeReport();
		await saveReport(report);
		return json(report);
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 502 });
	}
}
