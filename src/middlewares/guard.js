/**
 * THE REUSABLE GUARD - reads the transition table (services/rules.js) and runs
 * the five checks from the plan, in order, for exactly one action on exactly
 * one booking:
 *
 *   1. Booking exists                        -> 404
 *   2. Ownership (actual relationship, not just req.user.role) -> 403
 *   3. Current status is legal for this action, per RULES[action].from -> 400
 *   4. Time conditions hold (RULES[action].time)                -> 400
 *   5. (left to the controller) apply change -> history -> side effects
 *
 * On success it attaches req.booking, req.rule, req.actionKey, req.now, req.settings
 * so the controller never re-derives them and can never skip a check by accident.
 *
 * IMPORTANT: this guard is for USER-FACING routes only. 'system' actions (the daily
 * job) do not go through HTTP auth/ownership and call the transition rules directly
 * (see services/dailyJob.js) - seeing 'system' here is a wiring bug.
 */
import Booking from '../models/Booking.js';
import { RULES } from '../services/rules.js';
import { settings } from '../config/settings.js';
import * as clock from '../services/clock.js';
import { notFound, forbidden, badRequest, unauthorized } from '../utils/errors.js';

export function guard(actionKey) {
  const rule = RULES[actionKey];
  if (!rule) throw new Error(`guard(): unknown action "${actionKey}" - not in rules.js`);
  if (rule.actor === 'system') {
    throw new Error(`guard(): "${actionKey}" is a system-only action and must not be wired to an HTTP route`);
  }

  return async function (req, res, next) {
    try {
      if (!req.user) return next(unauthorized());

      // 1. Booking exists
      const booking = await Booking.findById(req.params.id);
      if (!booking) return next(notFound('Booking not found'));

      // 2. Ownership - the real relationship, never role alone
      const uid = String(req.user.id);
      const isRenter = uid === String(booking.renterId);
      const isOwner = uid === String(booking.ownerId);
      const isAdmin = req.user.role === 'admin';

      let allowed = false;
      if (rule.actor === 'renter') allowed = isRenter;
      else if (rule.actor === 'owner') allowed = isOwner;
      else if (rule.actor === 'admin') allowed = isAdmin;
      if (!allowed) return next(forbidden(`Only the booking's ${rule.actor} can ${actionKey.replace(/_/g, ' ')}`));

      // 3. Current status legal for this action
      if (!rule.from.includes(booking.status)) {
        return next(badRequest(
          `Cannot ${actionKey.replace(/_/g, ' ')} a booking in status "${booking.status}" (allowed from: ${rule.from.join(', ')})`,
        ));
      }

      // 4. Time conditions
      const now = clock.now();
      const cfg = settings();
      if (rule.time) {
        const err = rule.time(booking, now, cfg);
        if (err) return next(badRequest(err));
      }

      req.booking = booking;
      req.rule = rule;
      req.actionKey = actionKey;
      req.now = now;
      req.settings = cfg;
      next();
    } catch (e) { next(e); }
  };
}
