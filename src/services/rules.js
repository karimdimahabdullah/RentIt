/**
 * THE TRANSITION TABLE - single source of truth for every lifecycle route,
 * the daily job and the guard. If a move is not here, it is illegal.
 *
 *  from   : statuses the booking may currently be in
 *  actor  : 'owner' | 'renter' | 'admin' | 'system'
 *  to     : resulting status (resolve chooses its own)
 *  time   : optional (booking, now, settings) => error message | null
 */
import { STATUS as S } from './statuses.js';

const t = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

export const RULES = {
  approve:        { from: [S.PENDING],  actor: 'owner',  to: S.APPROVED },
  reject:         { from: [S.PENDING],  actor: 'owner',  to: S.REJECTED },
  cancel_by_renter: { from: [S.PENDING, S.APPROVED], actor: 'renter', to: S.CANCELLED },
  cancel_by_owner:  { from: [S.APPROVED], actor: 'owner', to: S.CANCELLED },
  waive_penalty:  { from: [S.CANCELLED], actor: 'admin', to: S.CANCELLED /* unchanged */ },

  confirm_pickup: {
    // No time gate here on purpose: pickup can now happen EARLY, before the
    // specified start date. The controller decides whether the result is
    // PICKED_UP (early) or ACTIVE (on/after the start date) - see
    // phase5-lifecycle/controllers/lifecycleController.js: confirmPickup. `to` below is
    // indicative only (the common case); it is not read by the guard.
    from: [S.APPROVED], actor: 'owner', to: S.ACTIVE,
  },
  report_issue_at_pickup: {
    // The owner's alternative to confirm_pickup: instead of handing the
    // equipment over cleanly, something is wrong right now (damage already
    // present, wrong item staged, a dispute with the renter before handover)
    // and needs admin attention before this booking goes any further.
    from: [S.APPROVED], actor: 'owner', to: S.DISPUTED,
  },
  mark_no_show: {
    from: [S.APPROVED], actor: 'owner', to: S.NO_SHOW,
    time: (b, now, s) => (t(now) >= t(b.startDate) + s.noShowGraceMs
      ? null : 'No-show can only be marked after the start time plus the grace period'),
  },

  claim_return:   { from: [S.PICKED_UP, S.ACTIVE, S.OVERDUE], actor: 'renter', to: S.RETURN_CLAIMED },
  confirm_return: { from: [S.PICKED_UP, S.ACTIVE, S.OVERDUE, S.RETURN_CLAIMED], actor: 'owner', to: S.RETURNED },
  dispute_return: {
    from: [S.RETURN_CLAIMED], actor: 'owner', to: S.DISPUTED,
    time: (b, now, s) => (t(now) < t(b.returnClaimedAt) + s.returnConfirmWindowMs
      ? null : 'The owner confirmation window has closed; the return is auto-confirmed'),
  },
  dispute_no_show: {
    from: [S.NO_SHOW], actor: 'renter', to: S.DISPUTED,
    time: (b, now, s) => {
      if (b.noShowDisputedAt) return 'This no-show has already been disputed once';
      return t(now) <= t(b.noShowAt) + s.noShowDisputeWindowMs ? null : 'The no-show dispute window has closed';
    },
  },
  close:          { from: [S.RETURNED], actor: 'owner', to: S.COMPLETED },
  report_issue: {
    from: [S.RETURNED], actor: 'owner', to: S.DISPUTED,
    time: (b, now, s) => (t(now) <= t(b.returnedAt) + s.claimWindowMs
      ? null : 'The claim window has closed; issues can no longer be reported'),
  },
  resolve:        { from: [S.DISPUTED], actor: 'admin', to: null /* admin chooses */ },

  // ---- system (daily job) ------------------------------------------------
  expire_pending: {
    from: [S.PENDING], actor: 'system', to: S.CANCELLED,
    time: (b, now, s) => (t(now) - t(b.requestedAt || b.createdAt) >= s.pendingExpiryMs ? null : 'Pending window has not elapsed'),
  },
  expire_approved: {
    from: [S.APPROVED], actor: 'system', to: S.CANCELLED,
    time: (b, now, s) => (t(now) >= t(b.startDate) + s.approvedExpiryAfterStartMs ? null : 'Approved expiry window has not elapsed'),
  },
  activate_picked_up: {
    // Equipment was picked up EARLY (before the specified start date). The
    // rental window itself is date-driven, not action-driven, so nothing
    // needs to happen except time passing - this promotes it the moment the
    // start date arrives. (A pickup confirmed ON or AFTER the start date
    // skips PICKED_UP entirely and lands directly in ACTIVE - see
    // bookingController.confirmPickup - so this transition only ever fires
    // for the early-pickup case.)
    from: [S.PICKED_UP], actor: 'system', to: S.ACTIVE,
    time: (b, now) => (t(now) >= t(b.startDate) ? null : 'Start date has not arrived yet'),
  },
  flag_overdue: {
    from: [S.ACTIVE], actor: 'system', to: S.OVERDUE,
    time: (b, now) => (t(now) > t(b.endDate) ? null : 'End date has not passed'),
  },
  escalate_overdue: {
    from: [S.OVERDUE], actor: 'system', to: S.DISPUTED,
    time: (b, now, s) => (t(now) >= t(b.endDate) + s.overdueGraceMs ? null : 'Overdue grace period has not elapsed'),
  },
  auto_confirm_return: {
    from: [S.RETURN_CLAIMED], actor: 'system', to: S.RETURNED,
    time: (b, now, s) => (t(now) >= t(b.returnClaimedAt) + s.returnConfirmWindowMs ? null : 'Owner window still open'),
  },
  auto_close: {
    from: [S.RETURNED], actor: 'system', to: S.COMPLETED,
    time: (b, now, s) => (t(now) >= t(b.returnedAt) + s.claimWindowMs ? null : 'Claim window still open'),
  },
};
