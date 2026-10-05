/**
 * PHASE 4 routes - mounted as part of /api/bookings (see routes/bookingRoutes.js,
 * which combines this with the shared reads and Phase 5's routes under the
 * same base path, so the external URL shape is unaffected by this internal
 * split). Auth is applied once by the combiner, not here.
 */
import { Router } from 'express';
import { guard } from '../../middlewares/guard.js';
import * as bookingRequestController from '../controllers/bookingRequestController.js';
import Booking from '../../models/Booking.js';
import { forbidden, notFound } from '../../utils/errors.js';

const router = Router();

// ---- creation / payment (not part of the transition table) ----------------
router.post('/', bookingRequestController.createBooking);
router.post('/:id/pay', bookingRequestController.payDemo);

// ---- owner responds ---------------------------------------------------------
router.post('/:id/approve', guard('approve'), bookingRequestController.approve);
router.post('/:id/reject', guard('reject'), bookingRequestController.reject);

// ---- cancellation -------------------------------------------------------------
router.post('/:id/cancel', async (req, res, next) => {
  // Same endpoint for both actors. Decide by the booking's ACTUAL relationship to
  // this user, never by their general account role - the same person could be a
  // renter on one booking and an owner on another.
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return next(notFound('Booking not found'));
    const uid = String(req.user.id);
    const isOwner = uid === String(booking.ownerId);
    const isRenter = uid === String(booking.renterId);
    if (!isOwner && !isRenter) return next(forbidden('You are not the renter or owner on this booking'));
    const actionKey = isOwner && !isRenter ? 'cancel_by_owner' : 'cancel_by_renter';
    req._resolvedCancelAction = actionKey;
    return guard(actionKey)(req, res, next);
  } catch (e) { next(e); }
}, (req, res, next) => {
  return (req._resolvedCancelAction === 'cancel_by_owner' ? bookingRequestController.cancelByOwner : bookingRequestController.cancelByRenter)(req, res, next);
});
router.post('/:id/waive-penalty', guard('waive_penalty'), bookingRequestController.waivePenalty);

export default router;
