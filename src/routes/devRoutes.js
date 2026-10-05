/**
 * Testing-only surface (plan sections 6 & 7). Gated by settings().enableDevRoutes
 * (env ENABLE_DEV_ROUTES=true). MUST be off in production - only mount this
 * router when that flag is set (see server.js).
 */
import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { forbidden } from '../utils/errors.js';
import * as devController from '../controllers/devController.js';

const router = Router();
router.use(auth);
router.use((req, res, next) => (req.user.role === 'admin' ? next() : next(forbidden('Admin only'))));

router.post('/seed', devController.seed);
router.post('/run-daily-job', devController.runJobNow);
router.post('/advance-clock', devController.advanceClock);
router.post('/reset-clock', devController.resetClock);
router.get('/now', devController.whatTimeIsIt);

export default router;
