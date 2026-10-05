# Phase 4 — Booking & Availability

**This entire folder is replaceable.** If a teammate builds a real Phase 4
module, this folder — plus the two import lines listed in "What to update
when you swap this out" below — is everything that changes. Nothing in
`src/phase5-lifecycle/`, `src/models/`, `src/middlewares/`, or
`src/services/` needs to be touched.

## What's in here

```
models/Cart.js                     one cart per user, reference implementation
controllers/
  bookingRequestController.js      createBooking, payDemo, approve, reject,
                                    cancelByRenter, cancelByOwner, waivePenalty
  cartController.js                add/remove/view/clear/checkout
routes/
  bookingRequestRoutes.js          mounted into /api/bookings by ../../routes/bookingRoutes.js
  cartRoutes.js                    mounted at /api/cart by ../../routes/index.js
services/
  bookingService.js                createBookingForRenter — the one function
                                    that actually inserts a Booking document
  checkoutService.js                checkoutItems(renterId, items) — see below
```

## The contract Phase 5 actually needs

Phase 5 (`src/phase5-lifecycle/`) does not call anything in this folder. It
only ever reads and writes `Booking` documents by `_id` and `status`. That
means the entire integration surface between the two phases is:

**Produce a `Booking` document sitting at `status: 'approved'`, with these
fields populated correctly:**

| Field | Why Phase 5 needs it |
|---|---|
| `renterId`, `ownerId`, `equipmentId` | ownership checks in every guard |
| `startDate`, `endDate` | the early-pickup vs. active decision, overdue flagging, late fees |
| `dailyRate`, `rentalAmount`, `depositAmount` | every money calculation from pickup through completion |
| `amountPaid`, `depositHeld` | refunds, deposit release, deductions — these are 0 until something sets them (see `payDemo`) |
| `approvedAt` | informational, shown in responses |

Whatever replaces this folder just needs to leave a document in that shape.
It does not need to call anything here, import anything here, or know this
folder exists.

## What to update when you swap this out

1. In `../../routes/index.js`, change the one line:
   ```js
   import cartRoutes from '../phase4-booking-availability/routes/cartRoutes.js';
   ```
   to point at the new module's cart router (or remove it, if the new module
   doesn't use a cart).
2. In `../../routes/bookingRoutes.js`, change:
   ```js
   import phase4BookingRequestRoutes from '../phase4-booking-availability/routes/bookingRequestRoutes.js';
   ```
   to the new module's router for create/pay/approve/reject/cancel.
3. Delete this folder.

That's it. The shared reads (`GET /:id`, `GET /:id/history`), the whole of
Phase 5, the dashboards, admin monitoring, and notifications are untouched.

## One ambiguity worth flagging

Your Phase 4 spec says "cancel if still Pending." Your Phase 5 spec doesn't
mention cancellation at all. The cancellation logic here (`cancelByRenter`,
`cancelByOwner`, `waivePenalty`) also handles cancelling an *Approved*
booking, with tiered penalties — that scenario isn't explicitly named in
either phase doc. It's kept here because cancellation is fundamentally about
releasing availability (this folder's domain), but if your team's actual
Phase 4 scope is narrower than what's implemented, this is the piece to trim
or move.
