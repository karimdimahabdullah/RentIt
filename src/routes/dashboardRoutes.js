/**
 * Mounted at /api (see routes/index.js), so the final paths are:
 *   GET /api/renters/:userId/dashboard
 *   GET /api/owners/:userId/dashboard
 *   GET /api/renters/:userId/bookings   (full list, paginated, ?status= filter)
 *   GET /api/owners/:userId/bookings    (full list, paginated, ?status= filter)
 */
import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import * as dashboardController from '../controllers/dashboardController.js';
import * as bookingListController from '../controllers/bookingListController.js';

const router = Router();
router.use(auth);

router.get('/renters/:userId/dashboard', dashboardController.renterDashboard);
router.get('/owners/:userId/dashboard', dashboardController.ownerDashboard);
router.get('/renters/:userId/bookings', bookingListController.listForRenter);
router.get('/owners/:userId/bookings', bookingListController.listForOwner);

export default router;
