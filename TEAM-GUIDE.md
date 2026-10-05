# RentIt — Rental Lifecycle Module: Team Guide

**Purpose of this document:** a self-contained explanation of every component
in this module — what it does, why it exists, and how it fits together —
written so a teammate who did not build it can understand it and merge their
own feature (Phase 4 — Booking & Availability, or anything else touching
bookings/equipment/users) against it with confidence.

This is not a tutorial on Express or Mongoose. It assumes you can read JS and
explains the *decisions*, not the syntax.

---

## 1. What this module is

This delivers **Phase 5 — Rental Lifecycle & Approvals**: once a booking is
Approved, everything that happens to it — pickup, the active rental window,
return, disputes, completion — plus the admin/renter/owner visibility into
all of that.

It also includes a **working implementation of Phase 4 — Booking &
Availability** (submitting a request, the overlap check, approve/reject, a
cart). That part exists so Phase 5 has something real to run against while
being built and tested — it is **not** presented as the team's final Phase 4
deliverable. It is isolated into its own folder specifically so it can be
replaced without touching anything else. Section 8 explains exactly how.

---

## 2. Architecture at a glance

```
src/
  server.js                      entry point — app.use('/api', apiRouter)
  config/                        env + DB connection
  models/                        SHARED — the data both phases read/write
  middlewares/                   SHARED — auth, the transition guard, error handling
  services/                      SHARED — the rules engine, money, time, background jobs
  utils/                         SHARED — error types
  controllers/                   SHARED — phase-agnostic reads (GET endpoints), dashboards, admin, notifications

  phase4-booking-availability/   REPLACEABLE — booking creation, overlap check,
                                  approve/reject, cart (see §8)
  phase5-lifecycle/              THE DELIVERABLE — pickup, active, return,
                                  disputes, resolve, close (see §8)
```

**The core idea:** there is exactly **one** `Booking` document type, and
exactly **one** table of legal status transitions (`services/rules.js`). Every
route — whichever phase it belongs to — reads and writes through that same
table via the same guard and the same atomic update function. Nothing about
a booking's legality is decided twice, in two places, by two different
people's code. That is the single most important thing to understand before
you touch this codebase, because it's also the thing most likely to break if
someone "helpfully" adds a parallel status check somewhere else.

---

## 3. The data model — `models/Booking.js`

This is the shared contract. If your Phase 4 work (or anyone else's) has its
own Booking/Reservation model, **this is what has to get merged into one
schema** — Mongoose silently drops fields it doesn't recognize, so a careless
merge doesn't error, it just quietly loses data.

| Field group | Fields | Purpose |
|---|---|---|
| Identity | `renterId`, `ownerId`, `equipmentId` | who and what. `ownerId` is a snapshot taken from the equipment at request time |
| Dates | `startDate`, `endDate` | the requested rental window |
| Status | `status`, `statusChangedAt`, `requestedAt` | current state + when it last changed. `status` is one of 12 values — see §4 |
| Money | `dailyRate`, `rentalAmount`, `depositAmount`, `amountPaid`, `depositHeld`, `refundedAmount`, `lateFeeAccrued` | everything needed to compute refunds/payouts without re-deriving pricing later |
| Approval facts | `approvedAt`, `rejectedAt`, `rejectionReason` | Phase 4 writes these |
| Cancellation facts | `cancelledAt`, `cancelledBy`, `cancellationReason`, `renterPenalty`, `ownerPenalty` | who cancelled, why, and the penalty tier applied |
| Pickup facts | `pickedUpAt`, `pickupCondition` | condition is `{ notes, recordedBy, at }` |
| No-show facts | `noShowAt`, `noShowPenalty`, `noShowDisputedAt` | |
| Overdue facts | `overdueAt`, `lastLateFeeAccrualAt` | |
| Return facts | `returnClaimedAt`, `returnClaimNotes`, `returnedAt`, `returnConfirmedBy`, `returnCondition` | |
| Dispute facts | `disputedAt`, `disputedFrom`, `disputeReason`, `disputeOpenedBy` | `disputedFrom` records which stage the dispute came from |
| Completion facts | `completedAt`, `resolution` | `resolution` holds an admin's outcome/reason/deduction/penalty when a dispute is resolved |

Two indexes matter for correctness, not just speed:
`{ equipmentId, status, startDate, endDate }` is what makes the overlap check
(§7) fast enough to run on every booking creation and every approval.

---

## 4. The status machine

Twelve statuses, defined in one place: `services/statuses.js`. The happy path
is the top line below; every indented line under a status is something that
can happen *instead*, from that same status:

```
Pending
  → Approved
  → Rejected                              (owner declines)
  → Cancelled                             (renter cancels, or ignored too long)

Approved
  → Picked Up  → Active                   (picked up before the start date,
                                            then promoted automatically)
  → Active                                (picked up on/after the start date)
  → Disputed                              (owner reports an issue at pickup)
  → No Show    → Disputed                 (never collected; renter can contest it)
  → Cancelled                             (either side cancels, or never acted on)

Picked Up / Active / Overdue
  → Return Claimed  → Returned            (renter claims it, owner confirms —
                                            or the window closes and it auto-confirms)
                    → Disputed            (owner contests the claimed return)
  → Returned                              (owner confirms directly, no claim step)

Active
  → Overdue → Disputed                    (past end date; escalates if ignored)

Returned
  → Completed                             (owner closes it, or the claim window closes)
  → Disputed                              (owner reports an issue after the fact)

Disputed
  → Completed / Cancelled / No Show       (admin picks the outcome)
```

| Status | Meaning |
|---|---|
| `pending` | Renter submitted a request; owner hasn't responded |
| `approved` | Owner accepted; waiting for pickup |
| `rejected` | Owner declined |
| `cancelled` | Renter or owner called it off (or the system expired it) |
| `no_show` | Renter never collected the equipment past the grace period |
| `picked_up` | Collected **before** the official start date (see §4a) |
| `active` | The rental window is underway (on/after `startDate`, before `endDate`) |
| `overdue` | Past `endDate`, not yet returned |
| `return_claimed` | Renter says they returned it; owner hasn't confirmed |
| `returned` | Owner confirmed the return |
| `disputed` | Something needs admin attention — can arrive here from pickup, no-show, a claimed return, overdue, or a post-return report |
| `completed` | Done. Deposit settled, owner paid |

### 4a. Why `picked_up` and `active` are separate

This was a deliberate, discussed design choice, not an oversight: a renter's
`startDate` is when the rental period officially begins; physically
collecting the equipment is a different event that can happen before, on, or
after that date.

- Pickup confirmed **before** `startDate` → `picked_up`. The equipment still
  counts as unavailable to everyone else (see §7), it just isn't "the active
  window" yet.
- The **daily job** (§6) promotes `picked_up → active` automatically the
  moment `startDate` arrives — nobody has to click anything, because the
  active window is date-driven, not action-driven.
- Pickup confirmed **on or after** `startDate` (the common case) skips
  `picked_up` entirely and goes straight to `active`.
- Return is allowed directly from `picked_up` too, for the edge case of an
  early pickup that gets returned before the window ever starts.

### 4b. The transition table — `services/rules.js`

Every legal move, in one object. This is the file to read if you want to know
"can X happen from Y," and the file to extend if a new transition is ever
needed — never add a status check anywhere else.

| Action | From | Actor | To | Time constraint |
|---|---|---|---|---|
| `approve` | pending | owner | approved | — |
| `reject` | pending | owner | rejected | — |
| `cancel_by_renter` | pending, approved | renter | cancelled | — |
| `cancel_by_owner` | approved | owner | cancelled | — |
| `waive_penalty` | cancelled | admin | cancelled (unchanged) | — |
| `confirm_pickup` | approved | owner | picked_up or active | — (decided by controller, see §4a) |
| `report_issue_at_pickup` | approved | owner | disputed | — |
| `mark_no_show` | approved | owner | no_show | after start + grace period |
| `claim_return` | picked_up, active, overdue | renter | return_claimed | — |
| `confirm_return` | picked_up, active, overdue, return_claimed | owner | returned | — |
| `dispute_return` | return_claimed | owner | disputed | before the owner confirmation window closes |
| `dispute_no_show` | no_show | renter | disputed | before the dispute window closes, once only |
| `close` | returned | owner | completed | — |
| `report_issue` | returned | owner | disputed | before the claim window closes |
| `resolve` | disputed | admin | completed, cancelled, or no_show (admin picks) | — |
| `expire_pending` *(system)* | pending | system | cancelled | after the pending window |
| `expire_approved` *(system)* | approved | system | cancelled | long after start, never picked up |
| `activate_picked_up` *(system)* | picked_up | system | active | once start date arrives |
| `flag_overdue` *(system)* | active | system | overdue | past end date |
| `escalate_overdue` *(system)* | overdue | system | disputed | after the overdue grace period |
| `auto_confirm_return` *(system)* | return_claimed | system | returned | owner window closed |
| `auto_close` *(system)* | returned | system | completed | claim window closed |

### 4c. The guard — `middlewares/guard.js`

Every user-facing action above runs through `guard(actionKey)`, which performs
five checks **in this order**, before any controller code runs:

1. **Booking exists** → 404 if not
2. **Ownership** — the *actual* relationship (`booking.renterId`/`ownerId` ===
   the authenticated user), never just their account role → 403 if not
3. **Status is legal** for this action, per the table above → 400 if not
4. **Time condition** holds, if the action has one → 400 if not
5. (left to the controller) apply the change

This is why role alone is never enough to authorize an action in this
codebase: a user with `role: 'owner'` cannot approve a booking that isn't
theirs, because the guard checks the specific booking's `ownerId`, not the
account's role field.

### 4d. The atomic update — `services/transitions.js`

One function, `transition(bookingId, fromStatus, patch)`, used by every
controller and the daily job. It's a MongoDB `findOneAndUpdate` conditioned on
the document **still being in `fromStatus`** at write time. If two requests
race to change the same booking, the second one gets `null` back and the
caller treats that as a 409 — never a silent double-transition. This is what
makes the race-condition handling in §7 actually safe.

---

## 5. Money & the audit trail

- **`services/ledger.js`** writes every money movement as a
  `LifecycleTransaction` document. Each write has a deterministic `reference`
  hash (booking + type + a salt), so if a request is retried — or the daily
  job runs twice — the same transaction is never recorded twice. Transaction
  types: `refund`, `deposit_release`, `renter_penalty`, `no_show_penalty`,
  `owner_penalty_debt`, `compensation`, `penalty_reversal`, `deduction`,
  `owner_earning`, `renter_debt` (this last one is declared but intentionally
  unused — see §9).
- **`models/OwnerBalance.js`** is a running total per owner (`balance`,
  `totalEarned`, `totalDebts`), incremented alongside every ledger write.
- **`services/history.js`** writes a `BookingHistory` entry for every
  transition — who, when, from what status to what, and why. This is the
  full audit trail behind `GET /api/bookings/:id/history`.

---

## 6. Background automation — `services/dailyJob.js`

Seven system-driven transitions run on a schedule (`services/scheduler.js`,
configurable cron) and can also be triggered on demand
(`POST /api/dev/run-daily-job`, non-production only) for testing: expiring
ignored requests, expiring never-picked-up approvals, promoting early pickups
to active, flagging overdue rentals, accruing late fees, escalating long
overdue rentals to a dispute, and auto-confirming/auto-closing after an
owner's response window closes. Every step uses the same atomic `transition()`
function as user actions, so running the job twice in a row is always safe —
it only touches bookings whose current status still makes them eligible.

---

## 7. Concurrency & the race condition

Two things worth understanding before changing anything here:

**The overlap rule** (`services/overlap.js`) is scoped to one equipment: a
new booking or cart item is refused outright if that equipment already has a
*confirmed* (approved/picked_up/active/overdue/return_claimed/disputed)
booking for overlapping dates. It does **not** refuse against another
Pending request — two different renters can both hold Pending requests for
the same equipment and dates. That's intentional: the owner decides between
them.

**The race this creates, and how it's resolved:** if two renters' Pending
requests for the same equipment end up overlapping, approving one of them
needs to do two things atomically: (a) re-check that nothing else already
claimed those dates, and (b) **automatically reject every other Pending
request that now conflicts**, each with a clear `rejectionReason` written
directly onto the booking, plus a `Notification` for the affected renter.
This runs inside a per-equipment lock (`services/lock.js`) so it can't be
interleaved with another approval on the same equipment.

**Limitation to know about:** `lock.js` is a single-process mutex (a document
with a unique `_id`), not a distributed lock. It's correct for one server
instance; it is not safe across multiple instances behind a load balancer
without a real distributed lock (Redis `SET NX PX`) or MongoDB transactions
on a replica set.

---

## 8. The Phase 4 / Phase 5 split — and how to replace Phase 4

`src/phase4-booking-availability/` and `src/phase5-lifecycle/` each have
their own `README.md` with the full detail. The short version:

**The entire integration contract is this:** Phase 5 does not import
anything from Phase 4. It only ever reads and writes a `Booking` document by
`_id` and `status`. So whatever replaces Phase 4 just needs to produce a
document at `status: 'approved'` with these fields correctly populated:
`renterId`, `ownerId`, `equipmentId`, `startDate`, `endDate`, `dailyRate`,
`rentalAmount`, `depositAmount`, and — if payment has happened —
`amountPaid`/`depositHeld`.

To actually swap it: change two import lines (`routes/index.js`'s cart-router
import, and `routes/bookingRoutes.js`'s request-router import), then delete
the `phase4-booking-availability/` folder. Nothing in `phase5-lifecycle/`, the
shared `models/`, `services/`, or `middlewares/` needs to change.

**What does *not* get split, and why:** `services/rules.js`,
`services/statuses.js`, `middlewares/guard.js`, and `models/Booking.js` are
shared infrastructure, not Phase 4 or Phase 5 property. A Phase 4 action and
a Phase 5 action both have to agree on what "Approved" means — duplicating
that table into two places would mean two sources of truth for the same
rules, which is a worse outcome than sharing them. Practically: Phase 4 and
Phase 5 are swappable at the file level, but not independently deployable — a
change to the shared transition table still needs sign-off from whoever owns
the other phase.

One unresolved mapping question, flagged rather than silently decided:
cancelling an **Approved** booking (with tiered penalties) isn't explicitly
named in either phase's spec — only "cancel if still Pending" appears
anywhere. It currently lives in the Phase 4 folder because cancellation is
about releasing availability, but if your team's actual Phase 4 scope is
narrower, that's the piece to move.

---

## 9. Known limitations (read before extending this)

- **`lock.js` is single-process only** (§7) — the biggest thing to fix before
  running more than one server instance.
- **`admin.resolve` doesn't cap `deductionAmount` against the deposit held.**
  An admin can currently deduct more than the deposit; there's a
  `renter_debt` transaction type declared for exactly this case and never
  used. Decide the cap/overage behavior before relying on this in production.
- **Dashboards and admin lists use plain queries, not database-side
  aggregation**, on the assumption of capstone-scale data volumes. Fine now;
  revisit with a `$group` aggregation if an owner/renter's booking history
  grows into the thousands.
- **The demo payment (`payDemo`) is a boolean flip**, not a real payment
  gateway integration.
- **Notifications are polling-only** (`GET /api/notifications`) — no
  websocket/push layer.
- **Cart items don't expire.** The overlap check re-runs at checkout, so a
  stale cart item just fails cleanly rather than silently succeeding — but
  nothing proactively tells a renter their cart went stale.
- **The `x-user-id`/`x-user-role` dev-auth headers** (`middlewares/auth.js`)
  only work when `ENABLE_DEV_ROUTES=true`. Replace this middleware with real
  JWT verification before any real deployment, and confirm that flag is unset
  in production.

---

## 10. API surface (condensed — see the main `README.md` for full request bodies)

| Area | Endpoints |
|---|---|
| Booking requests (Phase 4) | `POST /api/bookings`, `POST /:id/pay`, `POST /:id/approve`, `POST /:id/reject`, `POST /:id/cancel`, `POST /:id/waive-penalty` |
| Lifecycle (Phase 5) | `POST /:id/pickup`, `POST /:id/pickup/report-issue`, `POST /:id/no-show`, `POST /:id/no-show/dispute`, `POST /:id/return/claim`, `POST /:id/return/confirm`, `POST /:id/return/dispute`, `POST /:id/close`, `POST /:id/report-issue`, `POST /:id/resolve` |
| Reads (shared) | `GET /:id`, `GET /:id/history` |
| Cart | `GET /api/cart`, `POST /items`, `DELETE /items/:itemId`, `DELETE /`, `POST /checkout` |
| Dashboards & lists | `GET /api/renters/:userId/dashboard`, `GET /api/renters/:userId/bookings`, `GET /api/owners/:userId/dashboard`, `GET /api/owners/:userId/bookings` |
| Admin | `GET /api/admin/bookings` (always available, not dev-gated) |
| Notifications | `GET /api/notifications`, `POST /:id/read` |
| Dev/testing only | `POST /api/dev/seed`, `/run-daily-job`, `/advance-clock`, `/reset-clock`, `GET /now` |

---

## 11. Testing

```bash
npm test             # 54 tests — node's built-in test runner, no server needed
npm start            # boots the server
npm run postman      # 130 requests / 177 assertions via Newman, needs the server running
```

Tests go through the HTTP layer only (supertest against the app) — they never
import phase-specific files directly. That's deliberate: it's what let the
Phase 4/Phase 5 folder split happen with zero test changes and zero behavior
change, and it's what will let a real Phase 4 swap-in be verified the same
way (run the same test suite against the new module and see what still
passes).

---

## 12. Glossary

- **Booking** — the one document that represents a rental request and
  everything that happens to it afterward.
- **Transition** — a legal move from one status to another, defined in
  `rules.js`.
- **Guard** — the middleware that checks whether a transition is allowed
  before any business logic runs.
- **Overlap** — two bookings on the same equipment with intersecting date
  ranges.
- **Blocking status** — a status that makes an equipment's dates unavailable
  to new requests (everything from `approved` onward, until the booking ends
  terminally).
- **Settlement / ledger** — the money-movement record, separate from the
  booking's own status.
- **Dispute** — any booking sent to admin for manual resolution, regardless
  of which stage it came from.
