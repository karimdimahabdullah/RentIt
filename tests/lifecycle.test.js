import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/server.js';
import * as h from './helpers.js';
import Booking from '../src/models/Booking.js';
import BookingHistory from '../src/models/BookingHistory.js';
import LifecycleTransaction from '../src/models/LifecycleTransaction.js';
import OwnerBalance from '../src/models/OwnerBalance.js';
import { settings } from '../src/config/settings.js';

test.before(async () => { await h.connect(); });
test.beforeEach(async () => { await h.wipe(); });
test.after(async () => { await mongoose.disconnect(); });

async function createPendingBooking({ renter, owner, equipment, startInDays = 5, endInDays = 8 }) {
  const res = await request(app).post('/api/bookings')
    .set(h.bearer(renter))
    .send({ equipmentId: String(equipment._id), startDate: h.daysFromNow(startInDays), endDate: h.daysFromNow(endInDays) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.booking;
}

// ---------------------------------------------------------------------------
test('create booking: rejects booking your own equipment, past start, bad range', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  let res = await request(app).post('/api/bookings').set(h.bearer(owner)).send({ equipmentId: String(eq._id), startDate: h.daysFromNow(1), endDate: h.daysFromNow(2) });
  assert.equal(res.status, 400);

  res = await request(app).post('/api/bookings').set(h.bearer(renter)).send({ equipmentId: String(eq._id), startDate: h.daysFromNow(-1), endDate: h.daysFromNow(2) });
  assert.equal(res.status, 400);

  res = await request(app).post('/api/bookings').set(h.bearer(renter)).send({ equipmentId: String(eq._id), startDate: h.daysFromNow(3), endDate: h.daysFromNow(1) });
  assert.equal(res.status, 400);
});

test('two renters can both hold Pending requests on the same dates (no overlap block)', async () => {
  const { renter, otherRenter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const b1 = await createPendingBooking({ renter, owner, equipment: eq });
  const res2 = await request(app).post('/api/bookings').set(h.bearer(otherRenter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(5), endDate: h.daysFromNow(8) });
  assert.equal(res2.status, 201);
});

// ---------------------------------------------------------------------------
// GUARD: the five checks, generically
// ---------------------------------------------------------------------------
test('guard check 1: unknown booking id -> 404', async () => {
  const { owner } = await h.makeUsers();
  const fakeId = new mongoose.Types.ObjectId();
  const res = await request(app).post(`/api/bookings/${fakeId}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 404);
});

test('guard check 2: ownership - wrong owner cannot approve another owner\'s booking (loophole fix)', async () => {
  const { renter, owner, otherOwner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq });
  const res = await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(otherOwner)).send({});
  assert.equal(res.status, 403);
  const fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'pending'); // untouched
});

test('guard check 2: renter cannot approve their own booking, role alone is not enough', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq });
  const res = await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(renter)).send({});
  assert.equal(res.status, 403);
});

test('guard check 3: illegal status transition -> 400 (approve twice)', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq });
  let res = await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 200);
  res = await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400);
});

test('pickup before the start date lands in PICKED_UP, not ACTIVE (early pickup is allowed)', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 5, endInDays: 8 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});

  const res = await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({ notes: 'picked up early' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'picked_up');
  assert.ok(res.body.booking.pickedUpAt);

  // PICKED_UP still blocks the equipment's dates for anyone else.
  const { otherRenter } = await h.makeUsers();
  const conflictRes = await request(app).post('/api/bookings').set(h.bearer(otherRenter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(6), endDate: h.daysFromNow(7) });
  assert.equal(conflictRes.status, 409);

  // The daily job promotes it to ACTIVE once the start date arrives - not before.
  let jobRes = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(jobRes.body.summary.activated_picked_up, 0);

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 5 * 24 * 60 + 10 }); // past the 5-day start
  jobRes = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(jobRes.body.summary.activated_picked_up, 1);

  const fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'active');
});

test('pickup on or after the start date goes straight to ACTIVE (no PICKED_UP stop)', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  const res = await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'active');
});

test('a renter can return equipment directly from PICKED_UP (picked up early, returned before the window even starts)', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 5, endInDays: 8 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});

  const claimRes = await request(app).post(`/api/bookings/${booking._id}/return/claim`).set(h.bearer(renter)).send({});
  assert.equal(claimRes.status, 200);
  assert.equal(claimRes.body.booking.status, 'return_claimed');

  const confirmRes = await request(app).post(`/api/bookings/${booking._id}/return/confirm`).set(h.bearer(owner)).send({});
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.booking.status, 'returned');
});

test('guard check 4: no-show rejected before grace period elapses', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 3 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  const res = await request(app).post(`/api/bookings/${booking._id}/no-show`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400, 'should fail immediately at start time, before the grace period has elapsed');
});

// ---------------------------------------------------------------------------
// FULL HAPPY PATH
// ---------------------------------------------------------------------------
test('full happy path: pending -> approved -> active -> return claimed -> returned -> completed, deposit released, owner earns', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 3 });
  assert.equal(booking.rentalAmount, 300); // 3 days * 100

  let res = await request(app).post(`/api/bookings/${booking._id}/pay`).set(h.bearer(renter)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.amountPaid, 350);

  res = await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'approved');

  res = await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({ notes: 'Clean, full tank' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'active');
  assert.ok(res.body.booking.pickedUpAt);

  res = await request(app).post(`/api/bookings/${booking._id}/return/claim`).set(h.bearer(renter)).send({ notes: 'left at gate' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'return_claimed');

  res = await request(app).post(`/api/bookings/${booking._id}/return/confirm`).set(h.bearer(owner)).send({ notes: 'all good' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'returned');

  res = await request(app).post(`/api/bookings/${booking._id}/close`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'completed');

  const txs = await LifecycleTransaction.find({ bookingId: booking._id });
  const earn = txs.find(t => t.type === 'owner_earning');
  const release = txs.find(t => t.type === 'deposit_release');
  assert.equal(earn.amount, 300);
  assert.equal(release.amount, 50);

  const bal = await OwnerBalance.findOne({ ownerId: owner._id });
  assert.equal(bal.balance, 300);

  const history = await BookingHistory.find({ bookingId: booking._id }).sort({ at: 1 });
  const actions = history.map(x => x.action);
  assert.deepEqual(actions, ['create', 'demo_payment', 'approve', 'confirm_pickup', 'claim_return', 'confirm_return', 'close']);
});

test('reject: pending -> rejected, terminal, cannot be approved after', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq });
  let res = await request(app).post(`/api/bookings/${booking._id}/reject`).set(h.bearer(owner)).send({ reason: 'not available' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'rejected');
  res = await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// CANCELLATION TIERS
// ---------------------------------------------------------------------------
test('renter cancel Pending: always free, no penalty', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 10, endInDays: 12 });
  const res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(renter)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'cancelled');
  assert.equal(res.body.booking.renterPenalty.amount, 0);
});

test('renter cancel Approved >24h before start: free', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 10, endInDays: 12 });
  await request(app).post(`/api/bookings/${booking._id}/pay`).set(h.bearer(renter)).send({});
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  const res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(renter)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.renterPenalty.tier, 'free');
  const refund = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'refund' });
  assert.equal(refund.amount, 250); // 2 days * 100 rental + 50 deposit, full refund
});

test('renter cancel Approved inside 24h of start: penalty applied, partial refund', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 }); // "today" -> inside 24h cutoff (default 1440min)
  await request(app).post(`/api/bookings/${booking._id}/pay`).set(h.bearer(renter)).send({});
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  const res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(renter)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.renterPenalty.tier, 'late');
  assert.equal(res.body.booking.renterPenalty.amount, 10); // 20% of 50 deposit
  const refund = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'refund' });
  assert.equal(refund.amount, 240); // 250 paid - 10 penalty
});

test('once Active, nobody can cancel', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});
  let res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(renter)).send({});
  assert.equal(res.status, 400); // ownership is fine, but "active" is not a legal from-status for cancel
  const fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'active'); // untouched
});

// ---------------------------------------------------------------------------
// OWNER CANCELLATION + PENALTY + WAIVER
// ---------------------------------------------------------------------------
test('owner cancel: requires reason, full refund to renter, debt on owner, compensation to renter', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 10, endInDays: 12 });
  await request(app).post(`/api/bookings/${booking._id}/pay`).set(h.bearer(renter)).send({});
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});

  let res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400); // no reason

  res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(owner)).send({ reason: 'equipment broke' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.ownerPenalty.tier, 'early');
  assert.equal(res.body.booking.ownerPenalty.amount, 20); // 10% of 200 rental (2 days * 100)

  const refund = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'refund' });
  assert.equal(refund.amount, 250); // full refund of rental + deposit paid
  const debt = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'owner_penalty_debt' });
  assert.equal(debt.amount, 20);
  assert.equal(debt.status, 'owed');
  const comp = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'compensation' });
  assert.equal(comp.amount, 20);
  const bal = await OwnerBalance.findOne({ ownerId: owner._id });
  assert.equal(bal.balance, -20);
});

test('owner cancel inside 24h of start: late tier, higher penalty', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  const res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(owner)).send({ reason: 'no reliable ride' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.ownerPenalty.tier, 'late');
  assert.equal(res.body.booking.ownerPenalty.amount, 50); // 25% of 200 (2 days * 100)
});

test('admin can waive owner penalty with a reason; non-admin cannot', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 10, endInDays: 12 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/cancel`).set(h.bearer(owner)).send({ reason: 'stolen equipment' });

  let res = await request(app).post(`/api/bookings/${booking._id}/waive-penalty`).set(h.bearer(owner)).send({ reason: 'trying to waive own' });
  assert.equal(res.status, 403);

  res = await request(app).post(`/api/bookings/${booking._id}/waive-penalty`).set(h.bearer(admin)).send({});
  assert.equal(res.status, 400); // reason required

  res = await request(app).post(`/api/bookings/${booking._id}/waive-penalty`).set(h.bearer(admin)).send({ reason: 'confirmed theft report' });
  assert.equal(res.status, 200);
  const debt = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'owner_penalty_debt' });
  assert.equal(debt.status, 'waived');
  const bal = await OwnerBalance.findOne({ ownerId: owner._id });
  assert.equal(bal.balance, 0); // debt reversed

  res = await request(app).post(`/api/bookings/${booking._id}/waive-penalty`).set(h.bearer(admin)).send({ reason: 'again' });
  assert.equal(res.status, 409); // already waived
});

// ---------------------------------------------------------------------------
// NO-SHOW
// ---------------------------------------------------------------------------
test('no-show: only after grace period; penalty on deposit; owner earns rental; renter can dispute in window', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/pay`).set(h.bearer(renter)).send({});
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});

  let res = await request(app).post(`/api/bookings/${booking._id}/no-show`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400); // grace period not elapsed (default 180 min)

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 181 });

  res = await request(app).post(`/api/bookings/${booking._id}/no-show`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'no_show');
  assert.equal(res.body.booking.noShowPenalty, 10); // 20% of 50

  const earn = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'owner_earning' });
  assert.equal(earn.amount, 200); // 2 days * 100 rental
  const penalty = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'no_show_penalty' });
  assert.equal(penalty.amount, 10);
  const refund = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'refund' });
  assert.equal(refund.amount, 40);

  res = await request(app).post(`/api/bookings/${booking._id}/no-show/dispute`).set(h.bearer(renter)).send({ reason: 'I was there' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'disputed');

  res = await request(app).post(`/api/bookings/${booking._id}/no-show/dispute`).set(h.bearer(renter)).send({ reason: 'again' });
  assert.equal(res.status, 400); // already disputed / wrong status now
});

// ---------------------------------------------------------------------------
// RETURN / DISPUTE
// ---------------------------------------------------------------------------
test('pickup: owner can report an issue instead of confirming pickup, with a reason', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});

  let res = await request(app).post(`/api/bookings/${booking._id}/pickup/report-issue`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400); // reason required

  res = await request(app).post(`/api/bookings/${booking._id}/pickup/report-issue`).set(h.bearer(owner)).send({ reason: 'Equipment already damaged before handover' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'disputed');
  assert.equal(res.body.booking.disputedFrom, 'approved');

  // Once disputed, the normal pickup path is no longer available.
  res = await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400);
});

test('return: owner can dispute a claimed return with a reason', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/return/claim`).set(h.bearer(renter)).send({});

  let res = await request(app).post(`/api/bookings/${booking._id}/return/dispute`).set(h.bearer(owner)).send({});
  assert.equal(res.status, 400); // reason required

  res = await request(app).post(`/api/bookings/${booking._id}/return/dispute`).set(h.bearer(owner)).send({ reason: 'damaged' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'disputed');
});

test('report issue after Returned must happen within the claim window', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/return/confirm`).set(h.bearer(owner)).send({});

  let res = await request(app).post(`/api/bookings/${booking._id}/report-issue`).set(h.bearer(owner)).send({ reason: 'scratch found' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'disputed');
});

// ---------------------------------------------------------------------------
// ADMIN RESOLVE
// ---------------------------------------------------------------------------
test('admin resolve: disputed -> completed with deduction; only admin allowed; requires reason+valid outcome', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/pay`).set(h.bearer(renter)).send({});
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/return/confirm`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/report-issue`).set(h.bearer(owner)).send({ reason: 'damage' });

  let res = await request(app).post(`/api/bookings/${booking._id}/resolve`).set(h.bearer(owner)).send({ outcome: 'completed', reason: 'x' });
  assert.equal(res.status, 403);

  res = await request(app).post(`/api/bookings/${booking._id}/resolve`).set(h.bearer(admin)).send({ outcome: 'bogus', reason: 'x' });
  assert.equal(res.status, 400);

  res = await request(app).post(`/api/bookings/${booking._id}/resolve`).set(h.bearer(admin)).send({ outcome: 'completed', reason: 'minor scratch, deduct', deductionAmount: 20 });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking.status, 'completed');

  const release = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'deposit_release' });
  assert.equal(release.amount, 30); // 50 - 20
  const deduction = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'deduction' });
  assert.equal(deduction.amount, 20);
});

// ---------------------------------------------------------------------------
// SETTINGS FILE
// ---------------------------------------------------------------------------
test('settings: invalid env value throws instead of silently misbehaving', async () => {
  process.env.NO_SHOW_PENALTY_PERCENT = 'not-a-number';
  assert.throws(() => settings());
  delete process.env.NO_SHOW_PENALTY_PERCENT;
});

// ---------------------------------------------------------------------------
// DAILY JOB
// ---------------------------------------------------------------------------
test('daily job: expires ignored Pending requests after the window', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 10, endInDays: 12 });

  let res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.status, 200);
  let fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'pending'); // window not elapsed

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 2881 }); // > default 2880
  res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.body.summary.expired_pending, 1);
  fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'cancelled');
});

test('daily job: expires Approved with no pickup long after start, no penalty', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 4321 }); // > default 4320
  const res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.body.summary.expired_approved, 1);
  const fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'cancelled');
});

test('daily job: flags Active as Overdue after end date, accrues late fee, then escalates to Disputed', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 1 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 24 * 60 + 10 }); // past end date
  let res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.body.summary.flagged_overdue, 1);
  let fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'overdue');

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 24 * 60 }); // one more overdue day
  res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.body.summary.late_fees_accrued, 1);
  fresh = await Booking.findById(booking._id);
  assert.ok(fresh.lateFeeAccrued > 0);

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 4321 }); // > overdue grace 4320
  res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.body.summary.escalated_overdue, 1);
  fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'disputed');
});

test('daily job: auto-confirms a claimed return after owner window closes, then auto-closes after claim window', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${booking._id}/pay`).set(h.bearer(renter)).send({});
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/return/claim`).set(h.bearer(renter)).send({});

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 2881 }); // > 2880 confirm window
  let res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.body.summary.auto_confirmed_returns, 1);
  let fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'returned');
  assert.equal(fresh.returnConfirmedBy, 'system');

  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 2881 }); // > claim window
  res = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(res.body.summary.auto_closed, 1);
  fresh = await Booking.findById(booking._id);
  assert.equal(fresh.status, 'completed');
  const release = await LifecycleTransaction.findOne({ bookingId: booking._id, type: 'deposit_release' });
  assert.equal(release.amount, 50);
});

test('daily job is idempotent: running twice in a row does not double-act', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 10, endInDays: 12 });
  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 2881 });
  const r1 = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  const r2 = await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});
  assert.equal(r1.body.summary.expired_pending, 1);
  assert.equal(r2.body.summary.expired_pending, 0);
});

// ---------------------------------------------------------------------------
// OVERLAP RACE (loophole: two approvals race for the same dates)
// ---------------------------------------------------------------------------
test('overlap loophole: approving one booking auto-rejects the other overlapping Pending request', async () => {
  const { renter, otherRenter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const b1 = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 5, endInDays: 8 });
  const b2 = await createPendingBooking({ renter: otherRenter, owner, equipment: eq, startInDays: 6, endInDays: 9 });

  const res1 = await request(app).post(`/api/bookings/${b1._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res1.status, 200);
  // The response reports which other Pending bookings just got auto-rejected as a side effect.
  assert.deepEqual(res1.body.autoRejectedConflictingBookingIds.map(String), [String(b2._id)]);

  // b2 didn't wait around to be manually rejected - it's already gone.
  const fresh2 = await Booking.findById(b2._id);
  assert.equal(fresh2.status, 'rejected');
  assert.match(fresh2.rejectionReason, /booked by another renter/);

  // Trying to approve it now correctly fails on status, not on a fresh overlap check.
  const res2 = await request(app).post(`/api/bookings/${b2._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res2.status, 400);
});

test('cancelled booking does not keep blocking dates: a later booking can be approved after the first is cancelled', async () => {
  const { renter, otherRenter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner);
  const b1 = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 5, endInDays: 8 });
  await request(app).post(`/api/bookings/${b1._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${b1._id}/cancel`).set(h.bearer(renter)).send({});

  const b2 = await createPendingBooking({ renter: otherRenter, owner, equipment: eq, startInDays: 6, endInDays: 9 });
  const res2 = await request(app).post(`/api/bookings/${b2._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(res2.status, 200);
});

// ---------------------------------------------------------------------------
// AUTH / UNAUTHORIZED
// ---------------------------------------------------------------------------
test('no auth header -> 401', async () => {
  const res = await request(app).post('/api/bookings').send({});
  assert.equal(res.status, 401);
});
