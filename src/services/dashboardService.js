/**
 * Renter and owner dashboard aggregation.
 *
 * DESIGN DECISION (read this before you extend it): every number here is
 * computed LIVE from the Booking collection with plain find()/countDocuments()
 * queries - deliberately NOT with a $group aggregation pipeline, and NOT with
 * a separate denormalized "stats" document that gets incremented on every
 * transition. Two reasons:
 *
 *   1. A brand-new signup automatically gets an all-zero dashboard the moment
 *      they're queried, with no signup hook, no seed step, and no risk of a
 *      stats doc drifting from reality - because there is no second copy of
 *      the numbers to drift. This is what satisfies "give an empty rental
 *      action for a new signup": there's simply nothing to initialize.
 *   2. Aggregation $match against an ObjectId field silently returns nothing
 *      if you pass it a plain string instead of a cast ObjectId - a classic
 *      Mongoose footgun. find()/countDocuments() auto-cast query values for
 *      you, so this file has one less way to be subtly wrong.
 *
 * At capstone scale (a few hundred bookings per user, at most) this is a
 * handful of indexed queries per dashboard call - Booking already indexes
 * {renterId}, {ownerId} and {status}. If dashboard reads become a hot path
 * under real load, THEN consider a denormalized counters document (the
 * codebase already has that pattern - see OwnerBalance) - but don't do it
 * preemptively; every denormalized counter is one more place a bug can make
 * the number lie.
 *
 * "Total spent" is defined as the sum of `rentalAmount` (not the deposit,
 * which is refundable) across the renter's COMPLETED bookings. That's an
 * assumption your plan didn't pin down - flagged in the README.
 */
import Booking from '../models/Booking.js';
import { STATUS } from './statuses.js';
import { settings } from '../config/settings.js';
import * as clock from './clock.js';

// ---------------------------------------------------------------------------
// RENTER DASHBOARD
// ---------------------------------------------------------------------------
export async function getRenterDashboard(renterId) {
  const now = clock.now();

  const [upcoming, active, completed, overdue] = await Promise.all([
    Booking.find({ renterId, status: STATUS.APPROVED, startDate: { $gte: now } })
      .sort({ startDate: 1 })
      .select('equipmentId startDate endDate status'),

    // PICKED_UP counts as "active" here too, from the renter's point of view:
    // the equipment is already in their hands, whether or not the official
    // rental window has technically started yet.
    Booking.find({ renterId, status: { $in: [STATUS.PICKED_UP, STATUS.ACTIVE, STATUS.OVERDUE] } })
      .sort({ endDate: 1 })
      .select('equipmentId startDate endDate status overdueAt'),

    Booking.find({ renterId, status: STATUS.COMPLETED })
      .sort({ completedAt: -1 })
      .select('equipmentId startDate endDate completedAt rentalAmount'),

    Booking.find({ renterId, status: STATUS.OVERDUE })
      .sort({ endDate: 1 })
      .select('equipmentId startDate endDate overdueAt lateFeeAccrued'),
  ]);

  const totalSpent = completed.reduce((sum, b) => sum + b.rentalAmount, 0);

  const overdueList = overdue.map((b) => ({
    bookingId: b._id,
    equipmentId: b.equipmentId,
    startDate: b.startDate,
    endDate: b.endDate,
    overdueSince: b.overdueAt,
    daysOverdue: Math.floor((now - b.endDate) / (24 * 60 * 60 * 1000)),
    lateFeeAccruedSoFar: b.lateFeeAccrued || 0,
    reminder: `This rental was due back on ${b.endDate.toDateString()} and has not been returned.`,
  }));

  return {
    renterId,
    upcoming: {
      count: upcoming.length,
      nextRentalDate: upcoming[0] ? upcoming[0].startDate : null,
      bookings: upcoming.map((b) => ({ bookingId: b._id, equipmentId: b.equipmentId, startDate: b.startDate, endDate: b.endDate })),
    },
    active: {
      count: active.length,
      nextReturnDate: active[0] ? active[0].endDate : null,
      bookings: active.map((b) => ({ bookingId: b._id, equipmentId: b.equipmentId, startDate: b.startDate, endDate: b.endDate, status: b.status })),
    },
    completed: {
      count: completed.length,
      lastCompletedDate: completed[0] ? completed[0].completedAt : null,
      recentBookings: completed.slice(0, 5).map((b) => ({ bookingId: b._id, equipmentId: b.equipmentId, completedAt: b.completedAt, rentalAmount: b.rentalAmount })),
    },
    totalSpent: Math.round(totalSpent * 100) / 100,
    overdue: {
      count: overdueList.length,
      hasOverdueReturns: overdueList.length > 0,
      reminders: overdueList,
    },
  };
}

// ---------------------------------------------------------------------------
// OWNER DASHBOARD
// ---------------------------------------------------------------------------
export async function getOwnerDashboard(ownerId) {
  const now = clock.now();
  const cfg = settings();

  const [totalRequests, pendingBookings, returnClaimed, returnedAwaitingInspection] = await Promise.all([
    Booking.countDocuments({ ownerId }),

    Booking.find({ ownerId, status: STATUS.PENDING }).select('equipmentId'),

    Booking.find({ ownerId, status: STATUS.RETURN_CLAIMED })
      .sort({ returnClaimedAt: 1 })
      .select('equipmentId renterId returnClaimedAt returnClaimNotes'),

    Booking.find({ ownerId, status: STATUS.RETURNED })
      .sort({ returnedAt: 1 })
      .select('equipmentId renterId returnedAt returnCondition'),
  ]);

  // Group pending requests by equipment in plain JS - one owner's pending
  // list is small, so this needs no database-side grouping.
  const countsByEquipment = new Map();
  for (const b of pendingBookings) {
    const key = String(b.equipmentId);
    countsByEquipment.set(key, (countsByEquipment.get(key) || 0) + 1);
  }
  const requestedProducts = [...countsByEquipment.entries()].map(([equipmentId, pendingRequestCount]) => ({
    equipmentId, pendingRequestCount,
  }));

  const inspectionsDue = [
    ...returnClaimed.map((b) => ({
      bookingId: b._id,
      equipmentId: b.equipmentId,
      renterId: b.renterId,
      reason: 'renter claims this was returned - confirm or dispute',
      claimedAt: b.returnClaimedAt,
      dueBy: new Date(b.returnClaimedAt.getTime() + cfg.returnConfirmWindowMs),
      overdue: now.getTime() > b.returnClaimedAt.getTime() + cfg.returnConfirmWindowMs,
    })),
    ...returnedAwaitingInspection.map((b) => ({
      bookingId: b._id,
      equipmentId: b.equipmentId,
      renterId: b.renterId,
      reason: 'returned - inspect and either close or report an issue before the claim window closes',
      returnedAt: b.returnedAt,
      dueBy: new Date(b.returnedAt.getTime() + cfg.claimWindowMs),
      overdue: now.getTime() > b.returnedAt.getTime() + cfg.claimWindowMs,
    })),
  ].sort((a, b) => a.dueBy - b.dueBy);

  return {
    ownerId,
    totalRequests,
    requestedProducts,
    inspectionsDue: {
      count: inspectionsDue.length,
      items: inspectionsDue,
    },
  };
}
