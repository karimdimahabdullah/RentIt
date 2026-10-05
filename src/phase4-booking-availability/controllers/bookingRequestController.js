/**
 * PHASE 4 — Booking & Availability.
 *
 * This whole folder (src/phase4-booking-availability/) is the replaceable
 * half of the system. If your teammate ships a real Phase 4 module, this
 * folder - and only this folder, plus routes/cartRoutes.js's mount point in
 * routes/index.js - is what gets swapped out. See this folder's README.md
 * for the exact contract Phase 5 needs from whatever replaces it.
 *
 * What lives here: submitting a rental request, the overlap check, the
 * owner's approve/reject decision, cancellation (while Pending OR after
 * Approval - your Phase 4 spec only mentions "cancel if still Pending", but
 * cancelling an Approved booking never appears in the Phase 5 spec either;
 * it's kept here because cancellation is fundamentally about releasing
 * availability, which is this folder's domain - flagged in the README in
 * case your team wants to place it differently), and the cart (cartController.js,
 * cartRoutes.js, services/checkoutService.js, services/bookingService.js,
 * models/Cart.js - all in this same folder).
 */
import Booking from '../../models/Booking.js';
import LifecycleTransaction from '../../models/LifecycleTransaction.js';
import { STATUS } from '../../services/statuses.js';
import { hasOverlap, findOverlappingPending } from '../../services/overlap.js';
import { withLock } from '../../services/lock.js';
import * as history from '../../services/history.js';
import * as ledger from '../../services/ledger.js';
import { notify } from '../../services/notifications.js';
import { createBookingForRenter } from '../services/bookingService.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import * as clock from '../../services/clock.js';
import { round2, transition } from '../../services/transitions.js';

export async function createBooking(req, res, next) {
  try {
    const booking = await createBookingForRenter(req.user.id, req.body);
    res.status(201).json({ booking });
  } catch (e) { next(e); }
}
export async function payDemo(req, res, next) {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return next(notFound('Booking not found'));
    if (String(booking.renterId) !== String(req.user.id)) return next(badRequest('Only the renter can pay for this booking'));
    if (![STATUS.PENDING, STATUS.APPROVED].includes(booking.status)) {
      return next(badRequest(`Cannot pay for a booking in status "${booking.status}"`));
    }
    if (booking.amountPaid > 0) return next(conflict('This booking has already been paid'));

    const total = round2(booking.rentalAmount + booking.depositAmount);
    booking.amountPaid = total;
    booking.depositHeld = booking.depositAmount;
    await booking.save();
    await history.record({
      bookingId: booking._id, from: booking.status, to: booking.status, action: 'demo_payment',
      actorId: req.user.id, actorRole: 'renter', at: clock.now(), meta: { amount: total },
    });
    res.json({ booking });
  } catch (e) { next(e); }
}

export async function approve(req, res, next) {
  const { booking, now } = req;
  try {
    await withLock(`equipment:${booking.equipmentId}`, 5000, async () => {
      // Re-run the overlap check at approval time (loophole: two approvals race).
      const overlap = await hasOverlap({
        equipmentId: booking.equipmentId, startDate: booking.startDate, endDate: booking.endDate,
        excludeBookingId: booking._id,
      });
      if (overlap) throw conflict('These dates were just booked by another approved rental');

      // Atomic: only succeeds if this booking is still Pending (the "same operation" guard).
      const updated = await transition(booking._id, STATUS.PENDING, { to: STATUS.APPROVED, now, set: { approvedAt: now } });
      if (!updated) throw conflict('This booking is no longer pending');

      await history.record({ bookingId: booking._id, from: STATUS.PENDING, to: STATUS.APPROVED, action: 'approve', actorId: req.user.id, actorRole: 'owner', at: now });

      // This approval just won the equipment for these dates. Any OTHER still-
      // Pending request for the same equipment that overlaps these dates can
      // never be approved now - reject each one explicitly, with a reason,
      // instead of leaving it to dangle as Pending until someone notices or the
      // daily job eventually expires it. This is the race-condition case: two
      // renters' carts both checked out fine (Pending doesn't block Pending),
      // and only now, at approval time, does one of them actually lose.
      const losers = await findOverlappingPending({
        equipmentId: booking.equipmentId, startDate: booking.startDate, endDate: booking.endDate,
        excludeBookingId: booking._id,
      });
      const rejectedBookingIds = [];
      for (const loser of losers) {
        const reason = 'Equipment was booked by another renter for overlapping dates';
        const rejected = await transition(loser._id, STATUS.PENDING, { to: STATUS.REJECTED, now, set: { rejectedAt: now, rejectionReason: reason } });
        if (!rejected) continue; // it moved on its own in the meantime (e.g. renter cancelled) - fine, skip
        await history.record({ bookingId: loser._id, from: STATUS.PENDING, to: STATUS.REJECTED, action: 'auto_reject_conflicting', actorRole: 'system', at: now, reason, meta: { wonByBookingId: booking._id } });
        await notify({
          userId: loser.renterId, bookingId: loser._id, type: 'booking_rejected_conflict',
          message: `Your request for this equipment (${loser.startDate.toDateString()} - ${loser.endDate.toDateString()}) was rejected: another renter's request for overlapping dates was approved first.`,
        });
        rejectedBookingIds.push(loser._id);
      }

      res.json({ booking: updated, autoRejectedConflictingBookingIds: rejectedBookingIds });
    });
  } catch (e) { next(e); }
}

export async function reject(req, res, next) {
  const { booking, now } = req;
  try {
    const reason = req.body.reason;
    const updated = await transition(booking._id, STATUS.PENDING, { to: STATUS.REJECTED, now, set: { rejectedAt: now, rejectionReason: reason } });
    if (!updated) return next(conflict('This booking is no longer pending'));
    await history.record({ bookingId: booking._id, from: STATUS.PENDING, to: STATUS.REJECTED, action: 'reject', actorId: req.user.id, actorRole: 'owner', at: now, reason });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------
export async function cancelByRenter(req, res, next) {
  const { booking, now, settings: cfg } = req;
  try {
    const fromStatus = booking.status; // pending or approved
    let penalty = 0, tier = 'free';
    if (fromStatus === STATUS.APPROVED) {
      const insideCutoff = (booking.startDate.getTime() - now.getTime()) < cfg.freeCancelCutoffMs;
      if (insideCutoff) { penalty = round2(booking.depositAmount * cfg.lateCancelPenaltyPercent / 100); tier = 'late'; }
      else tier = 'free';
    }

    const updated = await transition(booking._id, fromStatus, {
      to: STATUS.CANCELLED, now,
      set: { cancelledAt: now, cancelledBy: 'renter', renterPenalty: { amount: penalty, tier } },
    });
    if (!updated) return next(conflict('This booking has already moved on'));

    await history.record({ bookingId: booking._id, from: fromStatus, to: STATUS.CANCELLED, action: 'cancel_by_renter', actorId: req.user.id, actorRole: 'renter', at: now, meta: { tier, penalty } });

    if (booking.amountPaid > 0) {
      const refund = round2(booking.amountPaid - penalty);
      await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'refund', party: 'renter', amount: refund, reason: `renter cancellation (${tier})`, salt: 'cancel_refund' });
      if (penalty > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'renter_penalty', party: 'platform', amount: penalty, reason: 'late cancellation penalty', salt: 'renter_penalty' });
    }
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function cancelByOwner(req, res, next) {
  const { booking, now, settings: cfg } = req;
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return next(badRequest('A reason is required when an owner cancels an approved booking'));

    const insideCutoff = (booking.startDate.getTime() - now.getTime()) < cfg.freeCancelCutoffMs;
    const tier = insideCutoff ? 'late' : 'early';
    const percent = insideCutoff ? cfg.ownerLateCancelPenaltyPercent : cfg.ownerEarlyCancelPenaltyPercent;
    const penalty = round2(booking.rentalAmount * percent / 100);

    const updated = await transition(booking._id, STATUS.APPROVED, {
      to: STATUS.CANCELLED, now,
      set: { cancelledAt: now, cancelledBy: 'owner', cancellationReason: reason, ownerPenalty: { amount: penalty, tier } },
    });
    if (!updated) return next(conflict('This booking has already moved on'));

    await history.record({ bookingId: booking._id, from: STATUS.APPROVED, to: STATUS.CANCELLED, action: 'cancel_by_owner', actorId: req.user.id, actorRole: 'owner', at: now, reason, meta: { tier, penalty } });

    if (booking.amountPaid > 0) {
      await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'refund', party: 'renter', amount: booking.amountPaid, reason: 'owner cancellation - full refund', salt: 'owner_cancel_refund' });
    }
    if (penalty > 0) {
      await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'owner_penalty_debt', party: 'owner', amount: penalty, status: 'owed', reason: `owner cancellation penalty (${tier})`, salt: 'owner_penalty' });
      await ledger.adjustOwnerBalance(booking.ownerId, -penalty, { debt: penalty });
      const renterShare = round2(penalty * cfg.ownerPenaltyRenterSharePercent / 100);
      if (renterShare > 0) {
        await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'compensation', party: 'renter', amount: renterShare, reason: 'owner cancellation compensation', salt: 'owner_penalty_comp' });
      }
    }
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function waivePenalty(req, res, next) {
  const { booking, now } = req;
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return next(badRequest('A reason is required to waive a penalty'));
    if (booking.cancelledBy !== 'owner' || !booking.ownerPenalty || booking.ownerPenalty.amount <= 0) {
      return next(badRequest('This booking has no owner penalty to waive'));
    }
    const debtTx = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'owner_penalty_debt' });
    if (!debtTx || debtTx.status === 'waived') return next(conflict('This penalty was already waived or was never recorded'));

    debtTx.status = 'waived';
    debtTx.waivedAmount = debtTx.amount;
    await debtTx.save();
    await ledger.adjustOwnerBalance(booking.ownerId, debtTx.amount, { debt: -debtTx.amount });

    await history.record({ bookingId: booking._id, from: STATUS.CANCELLED, to: STATUS.CANCELLED, action: 'waive_penalty', actorId: req.user.id, actorRole: 'admin', at: now, reason, meta: { amount: debtTx.amount } });
    res.json({ booking, waived: debtTx.amount });
  } catch (e) { next(e); }
}
