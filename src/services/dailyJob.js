/**
 * THE DAILY JOB (plan section 6). Every move here happens because time passed,
 * not because a user clicked. Runs on a cron schedule AND on demand (admin route
 * or `npm run job`), against the same code path, so expiry/overdue/auto-confirm
 * can be tested in one sitting instead of waiting days.
 *
 * Each step is idempotent: it only touches bookings whose current status makes
 * them eligible (RULES[...].from + RULES[...].time), via the same atomic
 * conditional update the user-facing actions use, so running the job twice in a
 * row is always safe.
 */
import Booking from '../models/Booking.js';
import { STATUS } from './statuses.js';
import { RULES } from './rules.js';
import { settings } from '../config/settings.js';
import * as clock from './clock.js';
import * as history from './history.js';
import * as ledger from './ledger.js';
import { round2, transition } from './transitions.js';

async function forEachEligible(actionKey, extraQuery, handle) {
  const rule = RULES[actionKey];
  const now = clock.now();
  const cfg = settings();
  const candidates = await Booking.find({ status: { $in: rule.from }, ...extraQuery });
  const results = [];
  for (const booking of candidates) {
    if (rule.time && rule.time(booking, now, cfg)) continue; // window hasn't elapsed yet
    const updated = await transition(booking._id, booking.status, { to: rule.to, now, set: handle ? handle(booking, now, cfg) : {} });
    if (!updated) continue; // someone else moved it first - fine, skip
    await history.record({ bookingId: booking._id, from: booking.status, to: rule.to, action: actionKey, actorRole: 'system', at: now });
    results.push(updated);
  }
  return results;
}

export async function runDailyJob({ at } = {}) {
  const run = async () => {
    const now = clock.now();
    const cfg = settings();
    const summary = {};

    // 1. Expire Pending requests the owner ignored.
    summary.expired_pending = (await forEachEligible('expire_pending', {}, () => ({ cancelledBy: 'system' }))).length;

    // 2. Expire Approved bookings whose start date is long past with no action.
    summary.expired_approved = (await forEachEligible('expire_approved', {})).length;

    // 2b. Promote early-pickup bookings (PICKED_UP) to ACTIVE once their
    // specified start date arrives. A pickup confirmed on/after the start
    // date already skips straight to ACTIVE, so this only ever fires for the
    // early-pickup case.
    summary.activated_picked_up = (await forEachEligible('activate_picked_up', {})).length;

    // 3. Flag Active bookings past end date as Overdue.
    summary.flagged_overdue = (await forEachEligible('flag_overdue', {}, () => ({ overdueAt: now }))).length;

    // 3b. Accrue late fees on bookings already Overdue (idempotent: tracks lastLateFeeAccrualAt).
    let feesAccrued = 0;
    for (const b of await Booking.find({ status: STATUS.OVERDUE })) {
      const since = b.lastLateFeeAccrualAt || b.overdueAt || b.endDate;
      const periods = Math.floor((now - since) / cfg.lateFeePeriodMs);
      if (periods > 0) {
        const fee = round2(b.dailyRate * (cfg.lateFeePercentOfDailyRate / 100) * periods);
        if (fee > 0) {
          b.lateFeeAccrued = round2((b.lateFeeAccrued || 0) + fee);
          b.lastLateFeeAccrualAt = new Date(since.getTime() + periods * cfg.lateFeePeriodMs);
          await b.save();
          feesAccrued++;
        }
      }
    }
    summary.late_fees_accrued = feesAccrued;

    // 4. Escalate Overdue bookings past grace period to Disputed.
    summary.escalated_overdue = (await forEachEligible('escalate_overdue', {}, () => ({ disputedAt: now, disputedFrom: 'overdue', disputeOpenedBy: 'system', disputeReason: 'overdue grace period elapsed' }))).length;

    // 5. Auto-confirm Return Claimed bookings whose owner window has closed.
    const autoConfirmed = await forEachEligible('auto_confirm_return', {}, () => ({ returnedAt: now, returnConfirmedBy: 'system' }));
    summary.auto_confirmed_returns = autoConfirmed.length;

    // 6. Close Returned bookings whose claim window has closed.
    const autoClosed = await forEachEligible('auto_close', {}, () => ({ completedAt: now }));
    for (const b of autoClosed) {
      await ledger.record({ bookingId: b._id, renterId: b.renterId, ownerId: b.ownerId, type: 'owner_earning', party: 'owner', amount: b.rentalAmount, reason: 'auto-closed after claim window', salt: 'complete_earning' });
      await ledger.adjustOwnerBalance(b.ownerId, b.rentalAmount, { earned: b.rentalAmount });
      const refund = round2(b.depositHeld - (b.lateFeeAccrued || 0));
      if (refund > 0) await ledger.record({ bookingId: b._id, renterId: b.renterId, ownerId: b.ownerId, type: 'deposit_release', party: 'renter', amount: refund, reason: 'auto-closed deposit release', salt: 'complete_refund' });
    }
    summary.auto_closed = autoClosed.length;

    summary.ranAt = now.toISOString();
    return summary;
  };
  return at ? clock.runAt(at, run) : run();
}
