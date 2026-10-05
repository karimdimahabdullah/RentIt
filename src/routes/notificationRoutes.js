/**
 * Mounted at /api/notifications. This is how a user finds out about events
 * they didn't personally trigger - e.g. "your pending request was rejected
 * because someone else's overlapping request was approved" (see
 * bookingController.approve()'s auto-reject-conflicting step).
 */
import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import * as notificationController from '../controllers/notificationController.js';

const router = Router();
router.use(auth);

router.get('/', notificationController.listMine);
router.post('/:id/read', notificationController.markRead);

export default router;
