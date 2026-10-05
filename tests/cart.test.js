import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/server.js';
import * as h from './helpers.js';
import Booking from '../src/models/Booking.js';

test.before(async () => { await h.connect(); });
test.beforeEach(async () => { await h.wipe(); });
test.after(async () => { await mongoose.disconnect(); });

// ---------------------------------------------------------------------------
// BASIC ADD / VIEW / REMOVE / CLEAR
// ---------------------------------------------------------------------------
test('cart: starts empty, items can be added, viewed, removed, and cleared', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });

  let res = await request(app).get('/api/cart').set(h.bearer(renter));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.cart.items, []);

  res = await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(5), endDate: h.daysFromNow(8) });
  assert.equal(res.status, 201);
  assert.equal(res.body.cart.items.length, 1);
  const itemId = res.body.cart.items[0]._id;

  res = await request(app).get('/api/cart').set(h.bearer(renter));
  assert.equal(res.body.cart.items.length, 1);

  res = await request(app).delete(`/api/cart/items/${itemId}`).set(h.bearer(renter));
  assert.equal(res.status, 200);
  assert.equal(res.body.cart.items.length, 0);

  // Add two, then clear the whole cart.
  await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(5), endDate: h.daysFromNow(8) });
  await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(20), endDate: h.daysFromNow(22) });
  res = await request(app).get('/api/cart').set(h.bearer(renter));
  assert.equal(res.body.cart.items.length, 2);
  res = await request(app).delete('/api/cart').set(h.bearer(renter));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.cart.items, []);
});

test('cart: cannot add your own equipment, invalid dates, or a past start date', async () => {
  const { renter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });

  let res = await request(app).post('/api/cart/items').set(h.bearer(owner))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(1), endDate: h.daysFromNow(2) });
  assert.equal(res.status, 400);

  res = await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(3), endDate: h.daysFromNow(1) });
  assert.equal(res.status, 400);

  res = await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(-5), endDate: h.daysFromNow(-1) });
  assert.equal(res.status, 400);
});

test('cart: refuses to add an item that overlaps an already-CONFIRMED booking', async () => {
  const { renter, otherRenter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });

  // Get one booking fully Approved first.
  let res = await request(app).post('/api/bookings').set(h.bearer(renter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(5), endDate: h.daysFromNow(8) });
  const approvedBooking = res.body.booking;
  await request(app).post(`/api/bookings/${approvedBooking._id}/approve`).set(h.bearer(owner)).send({});

  // A different renter tries to add the same equipment for overlapping dates.
  res = await request(app).post('/api/cart/items').set(h.bearer(otherRenter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(6), endDate: h.daysFromNow(7) });
  assert.equal(res.status, 409);

  // But two PENDING requests for the same dates are still fine to add (not yet confirmed).
  const eq2 = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  res = await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eq2._id), startDate: h.daysFromNow(10), endDate: h.daysFromNow(12) });
  assert.equal(res.status, 201);
  res = await request(app).post('/api/cart/items').set(h.bearer(otherRenter))
    .send({ equipmentId: String(eq2._id), startDate: h.daysFromNow(11), endDate: h.daysFromNow(13) });
  assert.equal(res.status, 201);
});

test('cart: caps at the max item count', async () => {
  const { renter, owner } = await h.makeUsers();
  for (let i = 0; i < 20; i++) {
    const eq = await h.makeEquipment(owner, { pricePerDay: 10, depositAmount: 5 });
    const res = await request(app).post('/api/cart/items').set(h.bearer(renter))
      .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(100 + i), endDate: h.daysFromNow(101 + i) });
    assert.equal(res.status, 201);
  }
  const eqOverflow = await h.makeEquipment(owner, { pricePerDay: 10, depositAmount: 5 });
  const res = await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eqOverflow._id), startDate: h.daysFromNow(500), endDate: h.daysFromNow(501) });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------
test('cart checkout: every item becomes its own independent Pending booking, cart is cleared', async () => {
  const { renter, owner, otherOwner } = await h.makeUsers();
  const eqA = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const eqB = await h.makeEquipment(otherOwner, { pricePerDay: 400, depositAmount: 200 });

  await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eqA._id), startDate: h.daysFromNow(5), endDate: h.daysFromNow(7) });
  await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eqB._id), startDate: h.daysFromNow(10), endDate: h.daysFromNow(11) });

  const res = await request(app).post('/api/cart/checkout').set(h.bearer(renter)).send({});
  assert.equal(res.status, 201);
  assert.equal(res.body.created.length, 2);
  assert.equal(res.body.failed.length, 0);
  // Different owners - each booking belongs to its own equipment's actual owner.
  const owners = res.body.created.map((b) => String(b.ownerId)).sort();
  assert.deepEqual(owners, [String(owner._id), String(otherOwner._id)].sort());

  const cartRes = await request(app).get('/api/cart').set(h.bearer(renter));
  assert.equal(cartRes.body.cart.items.length, 0);

  const count = await Booking.countDocuments({ renterId: renter._id });
  assert.equal(count, 2);
});

test('cart checkout: one bad item does not block the others, and stays in the cart for the renter to fix', async () => {
  const { renter, owner } = await h.makeUsers();
  const eqGood = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });
  const eqWillBeDeleted = await h.makeEquipment(owner, { pricePerDay: 50, depositAmount: 25 });

  await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eqGood._id), startDate: h.daysFromNow(5), endDate: h.daysFromNow(7) });
  await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eqWillBeDeleted._id), startDate: h.daysFromNow(10), endDate: h.daysFromNow(11) });

  // Simulate the equipment disappearing between "add to cart" and "checkout".
  const Equipment = (await import('../src/models/Equipment.js')).default;
  await Equipment.findByIdAndDelete(eqWillBeDeleted._id);

  const res = await request(app).post('/api/cart/checkout').set(h.bearer(renter)).send({});
  assert.equal(res.status, 201); // partial success is still a success
  assert.equal(res.body.created.length, 1);
  assert.equal(res.body.failed.length, 1);
  assert.match(res.body.failed[0].error, /not found/i);

  // The failed item is still sitting in the cart; the succeeded one is gone.
  const cartRes = await request(app).get('/api/cart').set(h.bearer(renter));
  assert.equal(cartRes.body.cart.items.length, 1);
  assert.equal(String(cartRes.body.cart.items[0].equipmentId), String(eqWillBeDeleted._id));
});

test('cart checkout: refuses an empty cart', async () => {
  const { renter } = await h.makeUsers();
  const res = await request(app).post('/api/cart/checkout').set(h.bearer(renter)).send({});
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// THE RACE: two renters check out overlapping requests for the SAME equipment;
// whichever gets approved first wins, the other is auto-rejected with a reason.
// ---------------------------------------------------------------------------
test('cart race: two renters checkout overlapping requests for the same equipment; approving one auto-rejects the other, with a notification', async () => {
  const { renter, otherRenter, owner } = await h.makeUsers();
  const eq = await h.makeEquipment(owner, { pricePerDay: 100, depositAmount: 50 });

  // Both renters add the SAME equipment with overlapping dates and check out -
  // both succeed, because Pending-vs-Pending is allowed (two carts, same race).
  await request(app).post('/api/cart/items').set(h.bearer(renter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(5), endDate: h.daysFromNow(8) });
  await request(app).post('/api/cart/items').set(h.bearer(otherRenter))
    .send({ equipmentId: String(eq._id), startDate: h.daysFromNow(6), endDate: h.daysFromNow(9) });

  const r1 = await request(app).post('/api/cart/checkout').set(h.bearer(renter)).send({});
  const r2 = await request(app).post('/api/cart/checkout').set(h.bearer(otherRenter)).send({});
  assert.equal(r1.body.created.length, 1);
  assert.equal(r2.body.created.length, 1);
  const bookingA = r1.body.created[0];
  const bookingB = r2.body.created[0];

  // Owner approves the first one that came in.
  const approveRes = await request(app).post(`/api/bookings/${bookingA._id}/approve`).set(h.bearer(owner)).send({});
  assert.equal(approveRes.status, 200);
  assert.deepEqual(approveRes.body.autoRejectedConflictingBookingIds.map(String), [String(bookingB._id)]);

  const fresh = await Booking.findById(bookingB._id);
  assert.equal(fresh.status, 'rejected');
  assert.match(fresh.rejectionReason, /booked by another renter/);

  // The losing renter has a notification waiting for them, even though they
  // never sent a request at the moment this happened.
  const notifRes = await request(app).get('/api/notifications').set(h.bearer(otherRenter));
  assert.equal(notifRes.status, 200);
  assert.equal(notifRes.body.notifications.length, 1);
  assert.equal(notifRes.body.unreadCount, 1);
  assert.match(notifRes.body.notifications[0].message, /approved first/);
});
