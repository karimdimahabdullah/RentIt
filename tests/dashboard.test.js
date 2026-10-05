import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/server.js';
import * as h from './helpers.js';

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
// RENTER DASHBOARD
// ---------------------------------------------------------------------------
test('renter dashboard: a brand-new signup with zero bookings gets an all-empty dashboard', async () => {
  const { renter } = await h.makeUsers();
  const res = await request(app).get(`/api/renters/${renter._id}/dashboard`).set(h.bearer(renter));
  assert.equal(res.status, 200);
  const d = res.body.dashboard;
  assert.equal(d.upcoming.count, 0);
  assert.equal(d.upcoming.nextRentalDate, null);
  assert.equal(d.active.count, 0);
  assert.equal(d.active.nextReturnDate, null);
  assert.equal(d.completed.count, 0);
  assert.equal(d.completed.lastCompletedDate, null);
  assert.equal(d.totalSpent, 0);
  assert.equal(d.overdue.count, 0);
  assert.equal(d.overdue.hasOverdueReturns, false);
});

test('renter dashboard: only the renter themself or an admin can view it', async () => {
  const { renter, otherRenter, admin } = await h.makeUsers();
  let res = await request(app).get(`/api/renters/${renter._id}/dashboard`).set(h.bearer(otherRenter));
  assert.equal(res.status, 403);
  res = await request(app).get(`/api/renters/${renter._id}/dashboard`).set(h.bearer(admin));
  assert.equal(res.status, 200);
});

test('renter dashboard: unknown user id -> 404, malformed id -> 400', async () => {
  const { admin } = await h.makeUsers();
  const fakeId = '000000000000000000000000';
  let res = await request(app).get(`/api/renters/${fakeId}/dashboard`).set(h.bearer(admin));
  assert.equal(res.status, 404);
  res = await request(app).get(`/api/renters/not-a-valid-id/dashboard`).set(h.bearer(admin));
  assert.equal(res.status, 400);
});

test('renter dashboard: upcoming, active, completed and overdue all report correctly', async () => {
  const { renter, owner } = await h.makeUsers();
  // Separate equipment per booking so none of these date ranges compete for the
  // same overlap check - this test is about the dashboard math, not scheduling.
  const eqUpcoming = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const eqActive = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const eqCompleted = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });

  // Upcoming: approved, starts in the future.
  const upcoming = await createPendingBooking({ renter, owner, equipment: eqUpcoming, startInDays: 10, endInDays: 12 });
  await request(app).post(`/api/bookings/${upcoming._id}/approve`).set(h.bearer(owner)).send({});

  // Active: approved, picked up, in progress.
  const active = await createPendingBooking({ renter, owner, equipment: eqActive, startInDays: 0, endInDays: 20 });
  await request(app).post(`/api/bookings/${active._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${active._id}/pickup`).set(h.bearer(owner)).send({});

  // Completed: full happy path, contributes to totalSpent.
  const completed = await createPendingBooking({ renter, owner, equipment: eqCompleted, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${completed._id}/pay`).set(h.bearer(renter)).send({});
  await request(app).post(`/api/bookings/${completed._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${completed._id}/pickup`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${completed._id}/return/confirm`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${completed._id}/close`).set(h.bearer(owner)).send({});

  const res = await request(app).get(`/api/renters/${renter._id}/dashboard`).set(h.bearer(renter));
  assert.equal(res.status, 200);
  const d = res.body.dashboard;

  assert.equal(d.upcoming.count, 1);
  assert.equal(new Date(d.upcoming.nextRentalDate).toDateString(), new Date(upcoming.startDate).toDateString());

  assert.equal(d.active.count, 1);
  assert.equal(new Date(d.active.nextReturnDate).toDateString(), new Date(active.endDate).toDateString());

  assert.equal(d.completed.count, 1);
  assert.ok(d.completed.lastCompletedDate);
  assert.equal(d.totalSpent, 200); // 2 days * 100/day on the completed booking

  assert.equal(d.overdue.count, 0);
});

test('renter dashboard: an overdue active rental shows up with a reminder', async () => {
  const { renter, owner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const booking = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 0, endInDays: 1 });
  await request(app).post(`/api/bookings/${booking._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${booking._id}/pickup`).set(h.bearer(owner)).send({});

  // Push the clock past the end date and run the daily job so it actually flips to Overdue.
  await request(app).post('/api/dev/advance-clock').set(h.bearer(admin)).send({ minutes: 24 * 60 + 10 });
  await request(app).post('/api/dev/run-daily-job').set(h.bearer(admin)).send({});

  const res = await request(app).get(`/api/renters/${renter._id}/dashboard`).set(h.bearer(renter));
  assert.equal(res.status, 200);
  const d = res.body.dashboard;
  assert.equal(d.overdue.count, 1);
  assert.equal(d.overdue.hasOverdueReturns, true);
  assert.ok(d.overdue.reminders[0].reminder.includes('due back on'));
  assert.ok(d.overdue.reminders[0].daysOverdue >= 0);
});

// ---------------------------------------------------------------------------
// OWNER DASHBOARD
// ---------------------------------------------------------------------------
test('owner dashboard: a brand-new owner with zero listings/requests gets an all-empty dashboard', async () => {
  const { owner } = await h.makeUsers();
  const res = await request(app).get(`/api/owners/${owner._id}/dashboard`).set(h.bearer(owner));
  assert.equal(res.status, 200);
  const d = res.body.dashboard;
  assert.equal(d.totalRequests, 0);
  assert.deepEqual(d.requestedProducts, []);
  assert.equal(d.inspectionsDue.count, 0);
});

test('owner dashboard: only the owner themself or an admin can view it', async () => {
  const { owner, otherOwner, admin } = await h.makeUsers();
  let res = await request(app).get(`/api/owners/${owner._id}/dashboard`).set(h.bearer(otherOwner));
  assert.equal(res.status, 403);
  res = await request(app).get(`/api/owners/${owner._id}/dashboard`).set(h.bearer(admin));
  assert.equal(res.status, 200);
});

test('owner dashboard: counts total requests and groups pending requests by product', async () => {
  const { renter, otherRenter, owner } = await h.makeUsers();
  const eqA = await h.makeEquipment(owner, { title: 'Generator', pricePerDay: 100, depositAmount: 50 });
  const eqB = await h.makeEquipment(owner, { title: 'Excavator', pricePerDay: 400, depositAmount: 200 });

  await createPendingBooking({ renter, owner, equipment: eqA, startInDays: 5, endInDays: 6 });
  await createPendingBooking({ renter: otherRenter, owner, equipment: eqA, startInDays: 20, endInDays: 21 });
  const approvedOne = await createPendingBooking({ renter, owner, equipment: eqB, startInDays: 30, endInDays: 31 });
  await request(app).post(`/api/bookings/${approvedOne._id}/approve`).set(h.bearer(owner)).send({});

  const res = await request(app).get(`/api/owners/${owner._id}/dashboard`).set(h.bearer(owner));
  assert.equal(res.status, 200);
  const d = res.body.dashboard;
  assert.equal(d.totalRequests, 3); // all bookings ever made against this owner, any status
  const productA = d.requestedProducts.find((p) => p.equipmentId === String(eqA._id));
  assert.equal(productA.pendingRequestCount, 2);
  const productB = d.requestedProducts.find((p) => p.equipmentId === String(eqB._id));
  assert.equal(productB, undefined); // it's approved now, not pending, so it drops out of "requested"
});

test('owner dashboard: flags inspections due for a claimed return and for a returned-but-not-yet-closed booking', async () => {
  const { renter, owner } = await h.makeUsers();
  const eqA = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const eqB = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });

  const claimed = await createPendingBooking({ renter, owner, equipment: eqA, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${claimed._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${claimed._id}/pickup`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${claimed._id}/return/claim`).set(h.bearer(renter)).send({});

  const returned = await createPendingBooking({ renter, owner, equipment: eqB, startInDays: 0, endInDays: 2 });
  await request(app).post(`/api/bookings/${returned._id}/approve`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${returned._id}/pickup`).set(h.bearer(owner)).send({});
  await request(app).post(`/api/bookings/${returned._id}/return/confirm`).set(h.bearer(owner)).send({});

  const res = await request(app).get(`/api/owners/${owner._id}/dashboard`).set(h.bearer(owner));
  assert.equal(res.status, 200);
  const d = res.body.dashboard;
  assert.equal(d.inspectionsDue.count, 2);
  const claimedItem = d.inspectionsDue.items.find((i) => i.bookingId === String(claimed._id));
  const returnedItem = d.inspectionsDue.items.find((i) => i.bookingId === String(returned._id));
  assert.ok(claimedItem);
  assert.ok(returnedItem);
  assert.equal(claimedItem.overdue, false);
  assert.equal(returnedItem.overdue, false);
  assert.ok(claimedItem.dueBy);
  assert.ok(returnedItem.dueBy);
});
