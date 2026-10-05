# Phase 5 — Rental Lifecycle & Approvals

**This is the actual deliverable.** Everything from the moment a booking is
Approved onward lives here: pickup, the Picked-Up/Active split, condition
recording, no-show, disputes raised at pickup or return, admin resolution,
and completion.

## What's in here

```
controllers/lifecycleController.js
  confirmPickup           Approved -> Picked Up (early) or Active (on/after start date)
  reportIssueAtPickup     Approved -> Disputed, instead of a clean handover
  markNoShow              Approved -> No-Show, after the grace period
  disputeNoShow           No-Show -> Disputed (renter contests it)
  claimReturn             Picked Up / Active / Overdue -> Return Claimed
  confirmReturn           ... -> Returned
  disputeReturn           Return Claimed -> Disputed (owner contests it)
  close                   Returned -> Completed
  reportIssue             Returned -> Disputed (owner reports it after the fact)
  resolve                 Disputed -> Completed / Cancelled / No-Show (admin only)
routes/lifecycleRoutes.js  mounted into /api/bookings by ../../routes/bookingRoutes.js
```

The status machine itself (`services/rules.js`), the guard that enforces it
(`middlewares/guard.js`), the daily job that drives the time-based
transitions (`services/dailyJob.js`), the dashboards, admin monitoring, and
notifications all live one level up, in the shared core — they're not
Phase-4-specific or Phase-5-specific, they're infrastructure both phases (and
any future phase) read from the same `Booking` collection.

## What this depends on from Phase 4

Exactly one thing: a `Booking` document at `status: 'approved'`, correctly
populated. See `../phase4-booking-availability/README.md` for the precise
field list. This folder does not import anything from
`phase4-booking-availability/` and never will — that's deliberate, so Phase 4
can be swapped out without touching a single line here.

## Status progression reference

```
pending → approved → picked_up → active → return_claimed → returned → completed
                   ↘ (on/after start date) ↗
```

See the root `README.md` §2 for the full explanation of why `picked_up` and
`active` are separate, and why the split is date-driven rather than
action-driven.
