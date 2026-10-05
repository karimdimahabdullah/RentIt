/**
 * ENTRY POINT. Everything is wired here, mounted the way the team asked for:
 *
 *   app.use('/api', apiRouter);
 *
 * which means every route in routes/index.js is reachable as /api/<whatever
 * that sub-router defines> - e.g. /api/bookings, /api/renters/:id/dashboard,
 * /api/dev/seed. See README.md for the full endpoint table and how to test
 * each one in Postman.
 */
import 'dotenv/config';
import express from 'express';
import { connectDB } from './config/db.js';
import { pathToFileURL } from 'url';
import { settings } from './config/settings.js';
import apiRouter from './routes/index.js';
import errorHandler from './middlewares/errorHandler.js';
import { startScheduler } from './services/scheduler.js';
// Registers the User/Equipment models if the host app hasn't already -
// delete this import once your team's real models are in place (see models/User.js).
import './models/User.js';
import './models/Equipment.js';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', apiRouter);
app.use(errorHandler); // must be last

async function start() {
  await connectDB();
  startScheduler();
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`RentIt lifecycle module listening on :${port}`));
}

// ESM equivalent of `if (require.main === module)` - only auto-start when this
// file is run directly (`node src/server.js`), not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) start();

export { app, start };
