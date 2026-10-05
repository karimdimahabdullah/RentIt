/**
 * THE ONE SETTINGS FILE.
 * Every number in the lifecycle (windows, penalties, fees) is read from here.
 * Each value reads from process.env first, then falls back to the default.
 * It is a function (not a constant) so changing .env / process.env takes effect
 * without touching any route, model or the daily job.
 *
 * Durations are in MINUTES so testing windows can be set to "2" instead of 2880.
 */
const MIN = 60 * 1000;

const num = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid setting ${key}="${raw}" (must be a number >= 0)`);
  return n;
};

const bool = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(String(raw).toLowerCase());
};

export function settings() {
  const isProd = process.env.NODE_ENV === 'production';
  return Object.freeze({
    // --- windows ---------------------------------------------------------
    pendingExpiryMs: num('PENDING_EXPIRY_MINUTES', 48 * 60) * MIN,               // owner ignores a request
    approvedExpiryAfterStartMs: num('APPROVED_EXPIRY_AFTER_START_MINUTES', 3 * 24 * 60) * MIN, // start "long past", nobody acted
    noShowGraceMs: num('NO_SHOW_GRACE_MINUTES', 3 * 60) * MIN,                   // after start time
    freeCancelCutoffMs: num('FREE_CANCEL_CUTOFF_MINUTES', 24 * 60) * MIN,        // before start
    noShowDisputeWindowMs: num('NO_SHOW_DISPUTE_WINDOW_MINUTES', 48 * 60) * MIN,
    returnConfirmWindowMs: num('RETURN_CONFIRM_WINDOW_MINUTES', 48 * 60) * MIN,  // owner window after "return claimed"
    claimWindowMs: num('CLAIM_WINDOW_MINUTES', 48 * 60) * MIN,                   // owner window after "returned" to report issues
    overdueGraceMs: num('OVERDUE_GRACE_MINUTES', 3 * 24 * 60) * MIN,             // before admin escalation
    lateFeePeriodMs: num('LATE_FEE_PERIOD_MINUTES', 24 * 60) * MIN,              // one "overdue day"

    // --- money (percentages) --------------------------------------------
    noShowPenaltyPercent: num('NO_SHOW_PENALTY_PERCENT', 20),                    // of deposit
    lateCancelPenaltyPercent: num('LATE_CANCEL_PENALTY_PERCENT', 20),            // renter, inside cutoff, of deposit
    lateFeePercentOfDailyRate: num('LATE_FEE_PERCENT_OF_DAILY_RATE', 100),       // per overdue period
    ownerEarlyCancelPenaltyPercent: num('OWNER_EARLY_CANCEL_PENALTY_PERCENT', 10), // of rental fee, > cutoff before start
    ownerLateCancelPenaltyPercent: num('OWNER_LATE_CANCEL_PENALTY_PERCENT', 25),   // of rental fee, inside cutoff
    ownerPenaltyRenterSharePercent: num('OWNER_PENALTY_RENTER_SHARE_PERCENT', 100), // rest goes to platform

    // --- runtime ---------------------------------------------------------
    dailyJobCron: process.env.DAILY_JOB_CRON || '0 2 * * *',
    enableScheduler: bool('ENABLE_SCHEDULER', true),
    allowTimeTravel: bool('ALLOW_TIME_TRAVEL', !isProd),   // dev clock + "now" override on the job route
    enableDevRoutes: bool('ENABLE_DEV_ROUTES', false),
  });
}
