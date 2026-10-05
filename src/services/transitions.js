/**
 * The one place a booking's status is actually written. Both the user-facing
 * controllers and the system daily job go through this, so "atomic conditional
 * update, only if the booking is still in the expected status" can never be
 * bypassed by one code path and not the other.
 */
import Booking from '../models/Booking.js';

export const round2 = (n) => Math.round(n * 100) / 100;

/** Atomically move a booking out of its current status. Returns null if someone
 *  else already moved it (caller must treat that as a 409, not silently succeed). */
export async function transition(bookingId, fromStatus, patch) {
  return Booking.findOneAndUpdate(
    { _id: bookingId, status: fromStatus },
    { $set: { status: patch.to, statusChangedAt: patch.now, ...patch.set } },
    { returnDocument: 'after' },
  );
}
