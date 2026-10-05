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
// RENTER / OWNER BOOKING LISTS
// ---------------------------------------------------------------------------
test('renter booking list: only the renter themself or an admin can view it; supports status filtering and pagination', async () => {
  const { renter, otherRenter, owner, admin } = await h.makeUsers();
  const eqA = await h.makeEquipment(owner, { pricePerDay: 50, depositAmount: 10 });
  const eqB = await h.makeEquipment(owner, { pricePerDay: 50, depositAmount: 10 });
  const b1 = await createPendingBooking({ renter, owner, equipment: eqA, startInDays: 5, endInDays: 6 });
  await createPendingBooking({ renter, owner, equipment: eqB, startInDays: 10, endInDays: 11 });
  await request(app).post(`/api/bookings/${b1._id}/approve`).set(h.bearer(owner)).send({});

  let res = await request(app).get(`/api/renters/${renter._id}/bookings`).set(h.bearer(otherRenter));
  assert.equal(res.status, 403);

  res = await request(app).get(`/api/renters/${renter._id}/bookings`).set(h.bearer(renter));
  assert.equal(res.status, 200);
  assert.equal(res.body.bookings.length, 2);
  assert.equal(res.body.pagination.total, 2);

  res = await request(app).get(`/api/renters/${renter._id}/bookings?status=approved`).set(h.bearer(renter));
  assert.equal(res.status, 200);
  assert.equal(res.body.bookings.length, 1);
  assert.equal(res.body.bookings[0].status, 'approved');

  res = await request(app).get(`/api/renters/${renter._id}/bookings?limit=1&page=1`).set(h.bearer(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.bookings.length, 1);
  assert.equal(res.body.pagination.pages, 2);
});

test('owner booking list: only the owner themself or an admin can view it', async () => {
  const { renter, owner, otherOwner, admin } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 50, depositAmount: 10 });
  await createPendingBooking({ renter, owner, equipment: eq, startInDays: 5, endInDays: 6 });

  let res = await request(app).get(`/api/owners/${owner._id}/bookings`).set(h.bearer(otherOwner));
  assert.equal(res.status, 403);

  res = await request(app).get(`/api/owners/${owner._id}/bookings`).set(h.bearer(owner));
  assert.equal(res.status, 200);
  assert.equal(res.body.bookings.length, 1);

  res = await request(app).get(`/api/owners/${owner._id}/bookings`).set(h.bearer(admin));
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// ADMIN: FULL VISIBILITY ACROSS EVERYONE
// ---------------------------------------------------------------------------
test('admin booking list: sees every booking from every user, filterable, 403 for non-admins', async () => {
  const { renter, otherRenter, owner, otherOwner, admin } = await h.makeUsers();
  const eqA = await h.makeEquipment(owner, { pricePerDay: 50, depositAmount: 10 });
  const eqB = await h.makeEquipment(otherOwner, { pricePerDay: 80, depositAmount: 20 });
  await createPendingBooking({ renter, owner, equipment: eqA, startInDays: 5, endInDays: 6 });
  await createPendingBooking({ renter: otherRenter, owner: otherOwner, equipment: eqB, startInDays: 10, endInDays: 11 });

  let res = await request(app).get('/api/admin/bookings').set(h.bearer(renter));
  assert.equal(res.status, 403);

  res = await request(app).get('/api/admin/bookings').set(h.bearer(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.pagination.total, 2);

  res = await request(app).get(`/api/admin/bookings?ownerId=${otherOwner._id}`).set(h.bearer(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.bookings.length, 1);
  assert.equal(String(res.body.bookings[0].ownerId), String(otherOwner._id));

  res = await request(app).get('/api/admin/bookings?status=pending').set(h.bearer(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.bookings.length, 2);
});

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------
test('notifications: a user only ever sees their own, and can mark one read', async () => {
  const { renter, otherRenter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const b1 = await createPendingBooking({ renter, owner, equipment: eq, startInDays: 5, endInDays: 8 });
  const eq2 = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  await createPendingBooking({ renter: otherRenter, owner, equipment: eq2, startInDays: 5, endInDays: 8 });

  const b2 = await createPendingBooking({ renter: otherRenter, owner, equipment: eq, startInDays: 6, endInDays: 9 });
  await request(app).post(`/api/bookings/${b1._id}/approve`).set(h.bearer(owner)).send({});

  let res = await request(app).get('/api/notifications').set(h.bearer(renter));
  assert.equal(res.status, 200);
  assert.equal(res.body.notifications.length, 0); // the winner gets nothing - nothing unusual happened to them

  res = await request(app).get('/api/notifications').set(h.bearer(otherRenter));
  assert.equal(res.status, 200);
  assert.equal(res.body.notifications.length, 1);
  assert.equal(res.body.unreadCount, 1);
  const notifId = res.body.notifications[0]._id;

  res = await request(app).post(`/api/notifications/${notifId}/read`).set(h.bearer(otherRenter)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.notification.read, true);

  res = await request(app).get('/api/notifications?unreadOnly=true').set(h.bearer(otherRenter));
  assert.equal(res.body.notifications.length, 0);

  // Can't mark someone else's notification read.
  const freshList = await request(app).get('/api/notifications').set(h.bearer(otherRenter));
  res = await request(app).post(`/api/notifications/${notifId}/read`).set(h.bearer(renter)).send({});
  assert.equal(res.status, 404);
});
