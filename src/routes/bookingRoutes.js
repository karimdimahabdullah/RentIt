/**
 * Mounted at /api/bookings (see routes/index.js). This file's only job is to
 * combine three things under one auth check and one base path, so the
 * external URL shape is identical to before the Phase 4 / Phase 5 split:
 *
 *   - shared reads (GET /:id, GET /:id/history)              -> bookingReadController.js
 *   - Phase 4: create, pay, approve, reject, cancel, waive    -> phase4-booking-availability/
 *   - Phase 5: pickup, no-show, return, close, dispute, admin -> phase5-lifecycle/
 *
 * If Phase 4 gets replaced by your teammate's module, only the middle import
 * below changes (see src/phase4-booking-availability/README.md) - this file,
 * routes/index.js, and everything in phase5-lifecycle/ stay untouched.
 */
import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import * as bookingReadController from '../controllers/bookingReadController.js';
import phase4BookingRequestRoutes from '../phase4-booking-availability/routes/bookingRequestRoutes.js';
import phase5LifecycleRoutes from '../phase5-lifecycle/routes/lifecycleRoutes.js';

const router = Router();
router.use(auth);

// ---- shared reads -----------------------------------------------------------
router.get('/:id', bookingReadController.getBooking);
router.get('/:id/history', bookingReadController.getHistory);

// ---- Phase 4: booking & availability -----------------------------------------
router.use(phase4BookingRequestRoutes);

// ---- Phase 5: rental lifecycle ------------------------------------------------
router.use(phase5LifecycleRoutes);

export default router;
