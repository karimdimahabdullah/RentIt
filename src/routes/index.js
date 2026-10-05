/**
 * THE single router mounted at /api in server.js:
 *   app.use('/api', apiRouter);
 *
 * /api/bookings and /api/cart are internally split into Phase 4
 * (src/phase4-booking-availability/) and Phase 5 (src/phase5-lifecycle/) -
 * see those folders' own README.md files. This file's URLs are unaffected by
 * that split; only the one `cartRoutes` import line below would change if
 * Phase 4 is ever replaced by a different module.
 *
 * Final paths:
 *   /api/bookings/...
 *   /api/cart/...
 *   /api/renters/:userId/dashboard
 *   /api/renters/:userId/bookings
 *   /api/owners/:userId/dashboard
 *   /api/owners/:userId/bookings
 *   /api/admin/bookings             (admin only, always mounted)
 *   /api/notifications/...
 *   /api/dev/...                    (only mounted when dev routes are enabled)
 */
import { Router } from 'express';
import bookingRoutes from './bookingRoutes.js';
import cartRoutes from '../phase4-booking-availability/routes/cartRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import adminRoutes from './adminRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import devRoutes from './devRoutes.js';
import { settings } from '../config/settings.js';

const router = Router();

router.use('/bookings', bookingRoutes);
router.use('/cart', cartRoutes);
router.use('/', dashboardRoutes);
router.use('/admin', adminRoutes);
router.use('/notifications', notificationRoutes);
if (settings().enableDevRoutes) router.use('/dev', devRoutes);

export default router;
