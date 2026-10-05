/**
 * THE reusable core of "create a booking for a renter." Used by the direct
 * POST /api/bookings route (controllers/bookingController.js) AND by
 * services/checkoutService.js (cart checkout) so there is exactly one place
 * that decides what makes a booking request valid. Throws an AppError (see
 * utils/errors.js) on any invalid input - callers decide whether that means
 * "fail the whole request" (direct create) or "skip this one item and keep
 * going" (cart checkout).
 *
 * Note this does NOT check for overlap against other PENDING requests - by
 * design, many renters may hold Pending requests for the same equipment and
 * dates at once; the owner decides between them at approval time, and
 * bookingController.approve() auto-rejects the losers. It DOES refuse a
 * request that overlaps an already-CONFIRMED (blocking-status) booking, since
 * that request could never succeed anyway - no point creating a doomed
 * Pending row.
 */
import Booking from '../../models/Booking.js';
import Equipment from '../../models/Equipment.js';
import { STATUS } from '../../services/statuses.js';
import { hasOverlap } from '../../services/overlap.js';
import * as history from '../../services/history.js';
import { round2 } from '../../services/transitions.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import * as clock from '../../services/clock.js';

export async function createBookingForRenter(renterId, { equipmentId, startDate, endDate }) {
  if (!equipmentId || !startDate || !endDate) throw badRequest('equipmentId, startDate and endDate are required');
  const start = new Date(startDate), end = new Date(endDate);
  if (!(start < end)) throw badRequest('endDate must be after startDate');
  if (start.getTime() < clock.now().getTime() - 60 * 1000) throw badRequest('startDate cannot be in the past');

  const equipment = await Equipment.findById(equipmentId);
  if (!equipment) throw notFound('Equipment not found');
  if (String(equipment.ownerId) === String(renterId)) throw badRequest('You cannot book your own equipment');

  const alreadyTaken = await hasOverlap({ equipmentId, startDate: start, endDate: end });
  if (alreadyTaken) throw conflict('This equipment is already booked for these dates');

  const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)));
  const dailyRate = equipment.pricePerDay;
  const rentalAmount = round2(dailyRate * days);
  const depositAmount = equipment.depositAmount || 0;

  const booking = await Booking.create({
    renterId,
    ownerId: equipment.ownerId,
    equipmentId,
    startDate: start,
    endDate: end,
    dailyRate,
    rentalAmount,
    depositAmount,
    status: STATUS.PENDING,
    requestedAt: clock.now(),
  });

  await history.record({
    bookingId: booking._id, from: null, to: STATUS.PENDING, action: 'create',
    actorId: renterId, actorRole: 'renter', at: clock.now(),
  });

  return booking;
}
