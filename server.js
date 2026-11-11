import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { missingConfig } from './auth.js';

const missing = missingConfig();
if (missing.length) {
	console.error(`bastion-heat: set ${missing.join(' and ')} in .env, it won't start without them`);
	process.exit(1);
}

const { handler } = await import('./build/handler.js');

const app = express();
const PORT = process.env.PORT || 5090;

app.disable('x-powered-by');
app.use(handler);

app.listen(PORT, () => console.log('bastion-heat on port', PORT));
