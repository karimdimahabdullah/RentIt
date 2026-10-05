/**
 * Overlap rule: an equipment's dates are blocked only by bookings in a BLOCKING
 * status. Two renters may both hold Pending requests on the same dates - the
 * second approval simply fails this check when it is actually run (loophole fix).
 *
 * Overlap is always scoped to ONE equipment (never "any equipment this owner
 * has"), because that's what the schema and the real-world constraint are:
 * you can't be in two places using the same generator at once, but the same
 * owner's two different generators are unrelated.
 */
import Booking from '../models/Booking.js';
import { BLOCKING_STATUSES, STATUS } from './statuses.js';

function overlapQuery({ equipmentId, startDate, endDate, statuses, excludeBookingId }) {
  return {
    equipmentId,
    status: { $in: statuses },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
    ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
  };
}

/** True/false: does a CONFIRMED (blocking-status) booking already occupy these
 *  dates on this equipment? Used to refuse a new booking/cart-item outright. */
export async function hasOverlap({ equipmentId, startDate, endDate, excludeBookingId, session }) {
  const q = Booking.findOne(overlapQuery({ equipmentId, startDate, endDate, statuses: BLOCKING_STATUSES, excludeBookingId }));
  if (session) q.session(session);
  return !!(await q);
}

/** The actual list of OTHER Pending bookings on this equipment that overlap
 *  a booking that was just approved. Used to auto-reject the losers of a race
 *  between two renters' requests for the same equipment + overlapping dates,
 *  instead of leaving them dangling as Pending until someone notices. */
export async function findOverlappingPending({ equipmentId, startDate, endDate, excludeBookingId, session }) {
  const q = Booking.find(overlapQuery({ equipmentId, startDate, endDate, statuses: [STATUS.PENDING], excludeBookingId }));
  if (session) q.session(session);
  return q;
}
