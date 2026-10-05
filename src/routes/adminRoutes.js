/**
 * Mounted at /api/admin - UNCONDITIONALLY, unlike /api/dev. This is a real
 * feature for real admins (booking oversight), not a testing convenience, so
 * it is never gated behind ENABLE_DEV_ROUTES. Gated purely by req.user.role
 * === 'admin' from real auth.
 */
import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { forbidden } from '../utils/errors.js';
import * as adminController from '../controllers/adminController.js';

const router = Router();
router.use(auth);
router.use((req, res, next) => (req.user.role === 'admin' ? next() : next(forbidden('Admin only'))));

router.get('/bookings', adminController.listAllBookings);

export default router;
