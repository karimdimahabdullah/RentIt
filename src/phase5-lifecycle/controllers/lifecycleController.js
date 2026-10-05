/**
 * PHASE 5 — Rental Lifecycle & Approvals. This is the actual deliverable.
 *
 * Covers everything from the moment a booking is Approved onward: pickup
 * (including the early-pickup/Picked-Up-vs-Active split - see README §2 in
 * the project root), condition recording at pickup/return, no-show, disputes
 * raised at pickup or return, admin resolution, and completion.
 *
 * Every function here assumes `guard(actionKey)` already ran (req.booking,
 * req.now, req.settings are set) and follows the fixed order: apply the
 * status change atomically -> write history -> THEN trigger side effects.
 * If the atomic update fails (someone else changed the booking first) we
 * bail out with 409 before touching money or history.
 */
import LifecycleTransaction from '../../models/LifecycleTransaction.js';
import { STATUS } from '../../services/statuses.js';
import * as history from '../../services/history.js';
import * as ledger from '../../services/ledger.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { round2, transition } from '../../services/transitions.js';

export async function confirmPickup(req, res, next) {
  const { booking, now } = req;
  try {
    const { notes } = req.body;
    // Early pickup (before the specified start date) lands in PICKED_UP and
    // waits for the start date to arrive (see services/dailyJob.js:
    // activate_picked_up). On-time or late pickup goes straight to ACTIVE -
    // the rental window has already begun, so there's no separate state to
    // sit in.
    const targetStatus = now.getTime() >= booking.startDate.getTime() ? STATUS.ACTIVE : STATUS.PICKED_UP;
    const updated = await transition(booking._id, STATUS.APPROVED, {
      to: targetStatus, now,
      set: { pickedUpAt: now, pickupCondition: { notes: notes || '', recordedBy: req.user.id, at: now } },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.APPROVED, to: targetStatus, action: 'confirm_pickup', actorId: req.user.id, actorRole: 'owner', at: now, notes });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function reportIssueAtPickup(req, res, next) {
  const { booking, now } = req;
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return next(badRequest('A reason is required to report an issue at pickup'));
    const updated = await transition(booking._id, STATUS.APPROVED, {
      to: STATUS.DISPUTED, now, set: { disputedAt: now, disputedFrom: 'approved', disputeReason: reason, disputeOpenedBy: 'owner' },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.APPROVED, to: STATUS.DISPUTED, action: 'report_issue_at_pickup', actorId: req.user.id, actorRole: 'owner', at: now, reason });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function markNoShow(req, res, next) {
  const { booking, now, settings: cfg } = req;
  try {
    const penalty = round2(booking.depositAmount * cfg.noShowPenaltyPercent / 100);
    const updated = await transition(booking._id, STATUS.APPROVED, {
      to: STATUS.NO_SHOW, now, set: { noShowAt: now, noShowPenalty: penalty },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.APPROVED, to: STATUS.NO_SHOW, action: 'mark_no_show', actorId: req.user.id, actorRole: 'owner', at: now });

    if (booking.amountPaid > 0) {
      await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'owner_earning', party: 'owner', amount: booking.rentalAmount, reason: 'no-show - rental fee earned', salt: 'noshow_earning' });
      await ledger.adjustOwnerBalance(booking.ownerId, booking.rentalAmount, { earned: booking.rentalAmount });
      if (penalty > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'no_show_penalty', party: 'platform', amount: penalty, reason: 'no-show penalty', salt: 'noshow_penalty' });
      const remainder = round2(booking.depositAmount - penalty);
      if (remainder > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'refund', party: 'renter', amount: remainder, reason: 'no-show deposit remainder', salt: 'noshow_refund' });
    }
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function disputeNoShow(req, res, next) {
  const { booking, now } = req;
  try {
    const { reason } = req.body;
    const updated = await transition(booking._id, STATUS.NO_SHOW, {
      to: STATUS.DISPUTED, now, set: { disputedAt: now, disputedFrom: 'no_show', disputeReason: reason, disputeOpenedBy: 'renter', noShowDisputedAt: now },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.NO_SHOW, to: STATUS.DISPUTED, action: 'dispute_no_show', actorId: req.user.id, actorRole: 'renter', at: now, reason });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------
export async function claimReturn(req, res, next) {
  const { booking, now } = req;
  try {
    const { notes } = req.body;
    const updated = await transition(booking._id, booking.status, {
      to: STATUS.RETURN_CLAIMED, now, set: { returnClaimedAt: now, returnClaimNotes: notes || '' },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: booking.status, to: STATUS.RETURN_CLAIMED, action: 'claim_return', actorId: req.user.id, actorRole: 'renter', at: now, notes });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function confirmReturn(req, res, next) {
  const { booking, now } = req;
  try {
    const { notes } = req.body;
    const updated = await transition(booking._id, booking.status, {
      to: STATUS.RETURNED, now,
      set: { returnedAt: now, returnConfirmedBy: 'owner', returnCondition: { notes: notes || '', recordedBy: req.user.id, at: now } },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: booking.status, to: STATUS.RETURNED, action: 'confirm_return', actorId: req.user.id, actorRole: 'owner', at: now, notes });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function disputeReturn(req, res, next) {
  const { booking, now } = req;
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return next(badRequest('A reason is required to dispute a return'));
    const updated = await transition(booking._id, STATUS.RETURN_CLAIMED, {
      to: STATUS.DISPUTED, now, set: { disputedAt: now, disputedFrom: 'return_claimed', disputeReason: reason, disputeOpenedBy: 'owner' },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.RETURN_CLAIMED, to: STATUS.DISPUTED, action: 'dispute_return', actorId: req.user.id, actorRole: 'owner', at: now, reason });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------
export async function close(req, res, next) {
  const { booking, now } = req;
  try {
    const deduction = round2(booking.lateFeeAccrued || 0);
    const refund = round2(booking.depositHeld - deduction);
    const updated = await transition(booking._id, STATUS.RETURNED, {
      to: STATUS.COMPLETED, now, set: { completedAt: now },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.RETURNED, to: STATUS.COMPLETED, action: 'close', actorId: req.user.id, actorRole: req.user.role === 'admin' ? 'admin' : 'owner', at: now });

    await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'owner_earning', party: 'owner', amount: booking.rentalAmount, reason: 'rental completed', salt: 'complete_earning' });
    await ledger.adjustOwnerBalance(booking.ownerId, booking.rentalAmount, { earned: booking.rentalAmount });
    if (deduction > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'deduction', party: 'platform', amount: deduction, reason: 'late fee deducted from deposit', salt: 'complete_deduction' });
    if (refund > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'deposit_release', party: 'renter', amount: refund, reason: 'deposit released', salt: 'complete_refund' });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

export async function reportIssue(req, res, next) {
  const { booking, now } = req;
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return next(badRequest('A reason is required to report an issue'));
    const updated = await transition(booking._id, STATUS.RETURNED, {
      to: STATUS.DISPUTED, now, set: { disputedAt: now, disputedFrom: 'returned', disputeReason: reason, disputeOpenedBy: 'owner' },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.RETURNED, to: STATUS.DISPUTED, action: 'report_issue', actorId: req.user.id, actorRole: 'owner', at: now, reason });
    res.json({ booking: updated });
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Admin resolution
// ---------------------------------------------------------------------------
export async function resolve(req, res, next) {
  const { booking, now } = req;
  try {
    const { outcome, reason, notes, deductionAmount = 0, penaltyAmount = 0 } = req.body;
    if (!['completed', 'cancelled', 'no_show'].includes(outcome)) {
      return next(badRequest('outcome must be one of: completed, cancelled, no_show'));
    }
    if (!reason || !reason.trim()) return next(badRequest('A reason is required to resolve a dispute'));

    const toStatus = outcome === 'completed' ? STATUS.COMPLETED : outcome === 'cancelled' ? STATUS.CANCELLED : STATUS.NO_SHOW;
    const updated = await transition(booking._id, STATUS.DISPUTED, {
      to: toStatus, now,
      set: {
        completedAt: toStatus === STATUS.COMPLETED ? now : undefined,
        cancelledAt: toStatus === STATUS.CANCELLED ? now : undefined,
        cancelledBy: toStatus === STATUS.CANCELLED ? 'system' : undefined,
        noShowAt: toStatus === STATUS.NO_SHOW ? now : undefined,
        resolution: { outcome, reason, notes, resolvedBy: req.user.id, resolvedAt: now, deductionAmount, penaltyAmount },
      },
    });
    if (!updated) return next(conflict('This booking has already moved on'));
    await history.record({ bookingId: booking._id, from: STATUS.DISPUTED, to: toStatus, action: 'resolve', actorId: req.user.id, actorRole: 'admin', at: now, reason, notes, meta: { outcome, deductionAmount, penaltyAmount } });

    const heldAmount = round2(booking.depositHeld - deductionAmount);
    if (deductionAmount > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'deduction', party: 'platform', amount: deductionAmount, reason: `admin resolution: ${reason}`, salt: 'resolve_deduction' });
    if (penaltyAmount > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'owner_penalty_debt', party: 'owner', amount: penaltyAmount, status: 'owed', reason: `admin resolution: ${reason}`, salt: 'resolve_penalty' });
    if (penaltyAmount > 0) await ledger.adjustOwnerBalance(booking.ownerId, -penaltyAmount, { debt: penaltyAmount });
    if (toStatus === STATUS.COMPLETED) {
      await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'owner_earning', party: 'owner', amount: booking.rentalAmount, reason: 'admin resolved - completed', salt: 'resolve_earning' });
      await ledger.adjustOwnerBalance(booking.ownerId, booking.rentalAmount, { earned: booking.rentalAmount });
      if (heldAmount > 0) await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'deposit_release', party: 'renter', amount: heldAmount, reason: 'admin resolved - deposit released', salt: 'resolve_release' });
    } else if (toStatus === STATUS.CANCELLED && heldAmount > 0) {
      await ledger.record({ bookingId: booking._id, renterId: booking.renterId, ownerId: booking.ownerId, type: 'refund', party: 'renter', amount: heldAmount, reason: 'admin resolved - cancelled', salt: 'resolve_refund' });
    }
    res.json({ booking: updated });
  } catch (e) { next(e); }
}
