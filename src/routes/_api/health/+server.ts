import { json } from '@sveltejs/kit';

/** open without login for Docker's healthcheck: says only that the app answers */
export const GET = () => json({ ok: true });
