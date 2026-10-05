import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let itemIdCounter = 1;
const uid = () => `req-${itemIdCounter++}`;

function req({ name, method, path, headers = [], body, tests = [], preScript, description }) {
  const item = {
    name,
    request: {
      method,
      header: headers.map(h => ({ key: h[0], value: h[1] })),
      url: { raw: `{{baseUrl}}${path}`, host: ['{{baseUrl}}'], path: path.replace(/^\//, '').split('/') },
      description,
    },
  };
  if (body) item.request.body = { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
  const events = [];
  if (preScript) events.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: preScript.split('\n') } });
  if (tests.length) events.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  if (events.length) item.event = events;
  return item;
}

const H_JSON = ['Content-Type', 'application/json'];
const asRenter = () => ['x-user-id', '{{renterId}}'];
const asOwner = () => ['x-user-id', '{{ownerId}}'];
const asOtherOwner = () => ['x-user-id', '{{otherOwnerId}}'];
const asOtherRenter = () => ['x-user-id', '{{otherRenterId}}'];
const asAdmin = () => ['x-user-id', '{{adminId}}'];
const roleRenter = ['x-user-role', 'renter'];
const roleOwner = ['x-user-role', 'owner'];
const roleAdmin = ['x-user-role', 'admin'];

const okTest = (label) => `pm.test("${label}", function () { pm.response.to.have.status(200); });`;
const statusTest = (code, label) => `pm.test("${label}", function () { pm.response.to.have.status(${code}); });`;

const saveBookingId = `
var json = pm.response.json();
if (json.booking && json.booking._id) { pm.environment.set("bookingId", json.booking._id); }
`;

const collection = {
  info: {
    name: 'RentIt - Rental Lifecycle Module',
    description: 'Standalone Postman suite for the RentIt rental lifecycle & approvals module.\n\nRun order: "0. Setup" first (seeds demo users + equipment and captures their ids into environment variables), then any other folder top-to-bottom. Each folder after Setup creates its own fresh booking as its first request, so folders can be re-run independently as long as Setup has run at least once.\n\nAuth: this collection uses the x-user-id / x-user-role dev headers (only active when ENABLE_DEV_ROUTES=true, the .env.example default). Swap these for a real `Authorization: Bearer <jwt>` header once wired into the full RentIt backend - see auth.js.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [],
  variable: [{ key: 'baseUrl', value: 'http://localhost:4000' }],
};

// ============================================================ 0. SETUP
collection.item.push({
  name: '0. Setup',
  item: [
    req({
      name: 'Seed demo users + equipment',
      method: 'POST', path: '/api/dev/seed',
      headers: [H_JSON, ['x-user-id', 'seed'], ['x-user-role', 'admin']],
      description: 'Wipes lifecycle collections and creates fixed demo users (renter, owner, admin, otherOwner, otherRenter) and two pieces of equipment. Run this first, and re-run any time you want a clean slate.',
      tests: [
        okTest('seed succeeded'),
        `var j = pm.response.json();`,
        `pm.environment.set("renterId", j.renterId);`,
        `pm.environment.set("ownerId", j.ownerId);`,
        `pm.environment.set("adminId", j.adminId);`,
        `pm.environment.set("otherOwnerId", j.otherOwnerId);`,
        `pm.environment.set("otherRenterId", j.otherRenterId);`,
        `pm.environment.set("equipmentId", j.equipmentId);`,
        `pm.environment.set("equipmentId2", j.equipmentId2);`,
        `pm.environment.set("equipmentId3", j.equipmentId3);`,
        `pm.environment.set("equipmentId4", j.equipmentId4);`,
        `pm.environment.set("equipmentId5", j.equipmentId5);`,
        `pm.environment.set("equipmentId6", j.equipmentId6);`,
        `pm.environment.set("equipmentId7", j.equipmentId7);`,
        `pm.environment.set("otherEquipmentId", j.otherEquipmentId);`,
      ],
    }),
    req({
      name: 'Reset clock to real time',
      method: 'POST', path: '/api/dev/reset-clock',
      headers: [H_JSON, asAdmin(), roleAdmin],
      tests: [okTest('clock reset')],
    }),
  ],
});

// ============================================================ 1. CREATE + PAY
collection.item.push({
  name: '1. Booking creation & payment',
  item: [
    req({
      name: 'Create booking (Pending)',
      method: 'POST', path: '/api/bookings',
      headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startDate}}', endDate: '{{endDate}}' },
      preScript: `
// start in 5 days, end in 8 days - overwrite the templated timestamps
var start = new Date(Date.now() + 5*24*60*60*1000);
var end = new Date(Date.now() + 8*24*60*60*1000);
pm.variables.set("startDate", start.toISOString());
pm.variables.set("endDate", end.toISOString());
      `,
      tests: [statusTest(201, 'booking created as pending'), saveBookingId,
        `pm.test("status is pending", function () { pm.expect(pm.response.json().booking.status).to.eql("pending"); });`],
    }),
    req({
      name: 'Reject: create your own equipment (should 400)',
      method: 'POST', path: '/api/bookings',
      headers: [H_JSON, asOwner(), roleOwner],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startDate}}', endDate: '{{endDate}}' },
      tests: [statusTest(400, 'owner cannot book own equipment')],
    }),
    req({
      name: 'Get booking',
      method: 'GET', path: '/api/bookings/{{bookingId}}',
      headers: [asRenter(), roleRenter],
      tests: [okTest('fetched booking')],
    }),
    req({
      name: 'Pay demo (rental + deposit)',
      method: 'POST', path: '/api/bookings/{{bookingId}}/pay',
      headers: [H_JSON, asRenter(), roleRenter],
      tests: [okTest('paid'), `pm.test("amountPaid > 0", function () { pm.expect(pm.response.json().booking.amountPaid).to.be.above(0); });`],
    }),
    req({
      name: 'Pay again (should 409 - already paid)',
      method: 'POST', path: '/api/bookings/{{bookingId}}/pay',
      headers: [H_JSON, asRenter(), roleRenter],
      tests: [statusTest(409, 'cannot pay twice')],
    }),
  ],
});

// ============================================================ 2. OWNER RESPONDS
collection.item.push({
  name: '2. Owner responds (approve / reject)',
  item: [
    req({ name: 'Create fresh booking', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startDate}}', endDate: '{{endDate}}' },
      preScript: `pm.variables.set("startDate", new Date(Date.now()+5*24*60*60*1000).toISOString());\npm.variables.set("endDate", new Date(Date.now()+8*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), saveBookingId] }),
    req({ name: 'Approve as wrong owner (403 - loophole check)', method: 'POST', path: '/api/bookings/{{bookingId}}/approve',
      headers: [H_JSON, asOtherOwner(), roleOwner], tests: [statusTest(403, 'wrong owner rejected')] }),
    req({ name: 'Approve as renter (403 - role/ownership check)', method: 'POST', path: '/api/bookings/{{bookingId}}/approve',
      headers: [H_JSON, asRenter(), roleRenter], tests: [statusTest(403, 'renter cannot approve')] }),
    req({ name: 'Approve (owner) - success', method: 'POST', path: '/api/bookings/{{bookingId}}/approve',
      headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved'),
        `pm.test("status is approved", function () { pm.expect(pm.response.json().booking.status).to.eql("approved"); });`] }),
    req({ name: 'Approve again (400 - already approved)', method: 'POST', path: '/api/bookings/{{bookingId}}/approve',
      headers: [H_JSON, asOwner(), roleOwner], tests: [statusTest(400, 'cannot approve twice')] }),
    req({ name: 'Create + reject a second booking', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startDate2}}', endDate: '{{endDate2}}' },
      preScript: `pm.variables.set("startDate2", new Date(Date.now()+20*24*60*60*1000).toISOString());\npm.variables.set("endDate2", new Date(Date.now()+22*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("rejectBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Reject (owner)', method: 'POST', path: '/api/bookings/{{rejectBookingId}}/reject',
      headers: [H_JSON, asOwner(), roleOwner], body: { reason: 'Not available those dates' },
      tests: [okTest('rejected'), `pm.test("status is rejected", function () { pm.expect(pm.response.json().booking.status).to.eql("rejected"); });`] }),
  ],
});

// ============================================================ 3. OVERLAP RACE (loophole)
collection.item.push({
  name: '3. Overlap & auto-reject-conflicting race',
  item: [
    req({ name: 'Create booking A (renter)', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startA}}', endDate: '{{endA}}' },
      preScript: `pm.variables.set("startA", new Date(Date.now()+30*24*60*60*1000).toISOString());\npm.variables.set("endA", new Date(Date.now()+33*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'A created'), `pm.environment.set("bookingA", pm.response.json().booking._id);`] }),
    req({ name: 'Create booking B (other renter, overlapping dates)', method: 'POST', path: '/api/bookings', headers: [H_JSON, asOtherRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startB}}', endDate: '{{endB}}' },
      preScript: `pm.variables.set("startB", new Date(Date.now()+31*24*60*60*1000).toISOString());\npm.variables.set("endB", new Date(Date.now()+34*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'B created - both Pending is fine, Pending never blocks another Pending'), `pm.environment.set("bookingB", pm.response.json().booking._id);`] }),
    req({ name: 'Approve A (succeeds, and auto-rejects B as a side effect)', method: 'POST', path: '/api/bookings/{{bookingA}}/approve',
      headers: [H_JSON, asOwner(), roleOwner],
      tests: [okTest('A approved'),
        `pm.test("B is reported as auto-rejected in the response", function () {\n  var ids = pm.response.json().autoRejectedConflictingBookingIds || [];\n  pm.expect(ids).to.include(pm.environment.get("bookingB"));\n});`] }),
    req({ name: "Confirm B's new status directly (no manual reject needed)", method: 'GET', path: '/api/bookings/{{bookingB}}',
      headers: [asAdmin(), roleAdmin],
      tests: [okTest('fetched'),
        `pm.test("B is rejected with a clear reason", function () {\n  var b = pm.response.json().booking;\n  pm.expect(b.status).to.eql("rejected");\n  pm.expect(b.rejectionReason).to.match(/booked by another renter/);\n});`] }),
    req({ name: 'Approve B now (400 - no longer Pending, not a fresh overlap check)', method: 'POST', path: '/api/bookings/{{bookingB}}/approve',
      headers: [H_JSON, asOwner(), roleOwner], tests: [statusTest(400, 'already rejected, cannot approve')] }),
    req({ name: "Other renter's notification about the auto-rejection", method: 'GET', path: '/api/notifications',
      headers: [asOtherRenter(), roleRenter],
      tests: [okTest('fetched'),
        `pm.test("has a notification explaining why their request was rejected", function () {\n  var n = pm.response.json().notifications;\n  pm.expect(n.length).to.be.at.least(1);\n  pm.expect(n[0].type).to.eql("booking_rejected_conflict");\n});`] }),
  ],
});

// ============================================================ 4. CANCELLATION
collection.item.push({
  name: '4. Cancellation (renter & owner)',
  item: [
    req({ name: 'Create + approve booking (renter cancel test)', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startDate}}', endDate: '{{endDate}}' },
      preScript: `pm.variables.set("startDate", new Date(Date.now()+10*24*60*60*1000).toISOString());\npm.variables.set("endDate", new Date(Date.now()+12*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), saveBookingId] }),
    req({ name: 'Pay demo', method: 'POST', path: '/api/bookings/{{bookingId}}/pay', headers: [H_JSON, asRenter(), roleRenter], tests: [okTest('paid')] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{bookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Renter cancel (>24h before start - free)', method: 'POST', path: '/api/bookings/{{bookingId}}/cancel',
      headers: [H_JSON, asRenter(), roleRenter], tests: [okTest('cancelled'),
        `pm.test("free tier", function () { pm.expect(pm.response.json().booking.renterPenalty.tier).to.eql("free"); });`] }),

    req({ name: 'Create + approve booking (owner cancel test)', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startDate3}}', endDate: '{{endDate3}}' },
      preScript: `pm.variables.set("startDate3", new Date(Date.now()+15*24*60*60*1000).toISOString());\npm.variables.set("endDate3", new Date(Date.now()+17*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("ownerCancelBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{ownerCancelBookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Owner cancel WITHOUT reason (400)', method: 'POST', path: '/api/bookings/{{ownerCancelBookingId}}/cancel',
      headers: [H_JSON, asOwner(), roleOwner], tests: [statusTest(400, 'reason required')] }),
    req({ name: 'Owner cancel WITH reason (success, penalty as debt)', method: 'POST', path: '/api/bookings/{{ownerCancelBookingId}}/cancel',
      headers: [H_JSON, asOwner(), roleOwner], body: { reason: 'Equipment broke down' },
      tests: [okTest('cancelled'), `pm.test("owner penalty recorded", function () { pm.expect(pm.response.json().booking.ownerPenalty.amount).to.be.above(0); });`] }),
    req({ name: 'Waive penalty as non-admin (403)', method: 'POST', path: '/api/bookings/{{ownerCancelBookingId}}/waive-penalty',
      headers: [H_JSON, asOwner(), roleOwner], body: { reason: 'trying to waive own' }, tests: [statusTest(403, 'non-admin cannot waive')] }),
    req({ name: 'Waive penalty as admin (success)', method: 'POST', path: '/api/bookings/{{ownerCancelBookingId}}/waive-penalty',
      headers: [H_JSON, asAdmin(), roleAdmin], body: { reason: 'Confirmed equipment failure, not owner negligence' },
      tests: [okTest('waived')] }),
  ],
});

// ============================================================ 5. PICKUP & NO-SHOW
collection.item.push({
  name: '5. Pickup & no-show',
  item: [
    req({ name: 'Create booking starting now', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId2}}', startDate: '{{startNow}}', endDate: '{{endNow}}' },
      preScript: `pm.variables.set("startNow", new Date(Date.now()).toISOString());\npm.variables.set("endNow", new Date(Date.now()+2*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), saveBookingId] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{bookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Pickup on/after start date -> goes straight to Active', method: 'POST', path: '/api/bookings/{{bookingId}}/pickup',
      headers: [H_JSON, asOwner(), roleOwner], body: { notes: 'Full tank, no visible damage' },
      tests: [okTest('picked up'), `pm.test("status is active", function () { pm.expect(pm.response.json().booking.status).to.eql("active"); });`] }),

    req({ name: 'Create + approve a booking for EARLY pickup', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId7}}', startDate: '{{earlyStart}}', endDate: '{{earlyEnd}}' },
      preScript: `pm.variables.set("earlyStart", new Date(Date.now()+5*24*60*60*1000).toISOString());\npm.variables.set("earlyEnd", new Date(Date.now()+8*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("earlyPickupBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{earlyPickupBookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Pickup BEFORE start date -> lands in Picked Up, not Active', method: 'POST', path: '/api/bookings/{{earlyPickupBookingId}}/pickup',
      headers: [H_JSON, asOwner(), roleOwner], body: { notes: 'Renter wanted it a few days early' },
      tests: [okTest('picked up'), `pm.test("status is picked_up", function () { pm.expect(pm.response.json().booking.status).to.eql("picked_up"); });`] }),
    req({ name: "Picked Up still blocks the equipment's dates for others", method: 'POST', path: '/api/bookings', headers: [H_JSON, asOtherRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId7}}', startDate: '{{earlyStart}}', endDate: '{{earlyEnd}}' },
      tests: [statusTest(409, 'blocked - equipment is already with the first renter')] }),
    req({ name: 'Run daily job before the start date (nothing to promote yet)', method: 'POST', path: '/api/dev/run-daily-job',
      headers: [H_JSON, asAdmin(), roleAdmin],
      tests: [okTest('ran'), `pm.test("nothing activated yet", function () { pm.expect(pm.response.json().summary.activated_picked_up).to.eql(0); });`] }),
    req({ name: 'Advance clock past the start date', method: 'POST', path: '/api/dev/advance-clock',
      headers: [H_JSON, asAdmin(), roleAdmin], body: { minutes: 5 * 24 * 60 + 10 }, tests: [okTest('advanced')] }),
    req({ name: 'Run daily job again - now promotes Picked Up to Active', method: 'POST', path: '/api/dev/run-daily-job',
      headers: [H_JSON, asAdmin(), roleAdmin],
      tests: [okTest('ran'), `pm.test("one booking activated", function () { pm.expect(pm.response.json().summary.activated_picked_up).to.eql(1); });`] }),
    req({ name: "Confirm it's Active now", method: 'GET', path: '/api/bookings/{{earlyPickupBookingId}}',
      headers: [asAdmin(), roleAdmin],
      tests: [okTest('fetched'), `pm.test("status is active", function () { pm.expect(pm.response.json().booking.status).to.eql("active"); });`] }),
    req({ name: 'Reset clock', method: 'POST', path: '/api/dev/reset-clock', headers: [H_JSON, asAdmin(), roleAdmin], tests: [okTest('reset')] }),

    req({ name: 'Create + approve a third booking (report-issue-at-pickup test)', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId4}}', startDate: '{{startNow3}}', endDate: '{{endNow3}}' },
      preScript: `pm.variables.set("startNow3", new Date(Date.now()+90*24*60*60*1000).toISOString());\npm.variables.set("endNow3", new Date(Date.now()+92*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("pickupIssueBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{pickupIssueBookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Report an issue at pickup instead of confirming it (reason required)', method: 'POST', path: '/api/bookings/{{pickupIssueBookingId}}/pickup/report-issue',
      headers: [H_JSON, asOwner(), roleOwner], tests: [statusTest(400, 'reason required')] }),
    req({ name: 'Report an issue at pickup (success -> Disputed)', method: 'POST', path: '/api/bookings/{{pickupIssueBookingId}}/pickup/report-issue',
      headers: [H_JSON, asOwner(), roleOwner], body: { reason: 'Equipment already has visible damage before handover' },
      tests: [okTest('disputed'), `pm.test("status is disputed, from approved", function () {\n  var b = pm.response.json().booking;\n  pm.expect(b.status).to.eql("disputed");\n  pm.expect(b.disputedFrom).to.eql("approved");\n});`] }),

    req({ name: 'Create + approve a second booking (no-show test)', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId3}}', startDate: '{{startNow2}}', endDate: '{{endNow2}}' },
      preScript: `pm.variables.set("startNow2", new Date(Date.now()).toISOString());\npm.variables.set("endNow2", new Date(Date.now()+2*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("noShowBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{noShowBookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Mark no-show BEFORE grace period (400)', method: 'POST', path: '/api/bookings/{{noShowBookingId}}/no-show',
      headers: [H_JSON, asOwner(), roleOwner], tests: [statusTest(400, 'grace period not elapsed')] }),
    req({ name: 'Advance clock past grace period (dev tool)', method: 'POST', path: '/api/dev/advance-clock',
      headers: [H_JSON, asAdmin(), roleAdmin], body: { minutes: 181 }, tests: [okTest('clock advanced')] }),
    req({ name: 'Mark no-show AFTER grace period (success)', method: 'POST', path: '/api/bookings/{{noShowBookingId}}/no-show',
      headers: [H_JSON, asOwner(), roleOwner],
      tests: [okTest('no-show recorded'), `pm.test("status is no_show", function () { pm.expect(pm.response.json().booking.status).to.eql("no_show"); });`] }),
    req({ name: 'Renter disputes the no-show (within window)', method: 'POST', path: '/api/bookings/{{noShowBookingId}}/no-show/dispute',
      headers: [H_JSON, asRenter(), roleRenter], body: { reason: 'I arrived on time, owner was not there' },
      tests: [okTest('disputed'), `pm.test("status is disputed", function () { pm.expect(pm.response.json().booking.status).to.eql("disputed"); });`] }),
    req({ name: 'Reset clock', method: 'POST', path: '/api/dev/reset-clock', headers: [H_JSON, asAdmin(), roleAdmin], tests: [okTest('reset')] }),
  ],
});

// ============================================================ 6. RETURN FLOW
collection.item.push({
  name: '6. Return (claim / confirm / dispute)',
  item: [
    req({ name: 'Create + approve + pickup', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId4}}', startDate: '{{startR}}', endDate: '{{endR}}' },
      preScript: `pm.variables.set("startR", new Date(Date.now()).toISOString());\npm.variables.set("endR", new Date(Date.now()+2*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), saveBookingId] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{bookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Pickup', method: 'POST', path: '/api/bookings/{{bookingId}}/pickup', headers: [H_JSON, asOwner(), roleOwner], body: { notes: 'clean' }, tests: [okTest('active')] }),
    req({ name: 'Renter claims return', method: 'POST', path: '/api/bookings/{{bookingId}}/return/claim', headers: [H_JSON, asRenter(), roleRenter],
      body: { notes: 'Left at the front gate' },
      tests: [okTest('return claimed'), `pm.test("status is return_claimed", function () { pm.expect(pm.response.json().booking.status).to.eql("return_claimed"); });`] }),
    req({ name: 'Owner confirms return', method: 'POST', path: '/api/bookings/{{bookingId}}/return/confirm', headers: [H_JSON, asOwner(), roleOwner],
      body: { notes: 'All good, minor wear' },
      tests: [okTest('returned'), `pm.test("status is returned", function () { pm.expect(pm.response.json().booking.status).to.eql("returned"); });`] }),

    req({ name: 'Create second booking for owner-direct-confirm + dispute test', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId5}}', startDate: '{{startR2}}', endDate: '{{endR2}}' },
      preScript: `pm.variables.set("startR2", new Date(Date.now()).toISOString());\npm.variables.set("endR2", new Date(Date.now()+2*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("disputeBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{disputeBookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Pickup', method: 'POST', path: '/api/bookings/{{disputeBookingId}}/pickup', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('active')] }),
    req({ name: 'Renter claims return', method: 'POST', path: '/api/bookings/{{disputeBookingId}}/return/claim', headers: [H_JSON, asRenter(), roleRenter], tests: [okTest('claimed')] }),
    req({ name: 'Owner disputes the claimed return (reason required)', method: 'POST', path: '/api/bookings/{{disputeBookingId}}/return/dispute',
      headers: [H_JSON, asOwner(), roleOwner], body: { reason: 'Equipment came back damaged' },
      tests: [okTest('disputed'), `pm.test("status is disputed", function () { pm.expect(pm.response.json().booking.status).to.eql("disputed"); });`] }),
  ],
});

// ============================================================ 7. COMPLETION
collection.item.push({
  name: '7. Completion (close / report issue)',
  item: [
    req({ name: 'Create + approve + pickup + return-confirm', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId6}}', startDate: '{{startC}}', endDate: '{{endC}}' },
      preScript: `pm.variables.set("startC", new Date(Date.now()).toISOString());\npm.variables.set("endC", new Date(Date.now()+2*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), saveBookingId] }),
    req({ name: 'Pay demo', method: 'POST', path: '/api/bookings/{{bookingId}}/pay', headers: [H_JSON, asRenter(), roleRenter], tests: [okTest('paid')] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{bookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Pickup', method: 'POST', path: '/api/bookings/{{bookingId}}/pickup', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('active')] }),
    req({ name: 'Owner confirms return', method: 'POST', path: '/api/bookings/{{bookingId}}/return/confirm', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('returned')] }),
    req({ name: 'Close: no issues (Completed, deposit released)', method: 'POST', path: '/api/bookings/{{bookingId}}/close',
      headers: [H_JSON, asOwner(), roleOwner],
      tests: [okTest('completed'), `pm.test("status is completed", function () { pm.expect(pm.response.json().booking.status).to.eql("completed"); });`] }),

    req({ name: 'Create second booking for report-issue test', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId7}}', startDate: '{{startC2}}', endDate: '{{endC2}}' },
      preScript: `pm.variables.set("startC2", new Date(Date.now()).toISOString());\npm.variables.set("endC2", new Date(Date.now()+2*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("issueBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Approve', method: 'POST', path: '/api/bookings/{{issueBookingId}}/approve', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('approved')] }),
    req({ name: 'Pickup', method: 'POST', path: '/api/bookings/{{issueBookingId}}/pickup', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('active')] }),
    req({ name: 'Owner confirms return', method: 'POST', path: '/api/bookings/{{issueBookingId}}/return/confirm', headers: [H_JSON, asOwner(), roleOwner], tests: [okTest('returned')] }),
    req({ name: 'Report issue (within claim window -> Disputed)', method: 'POST', path: '/api/bookings/{{issueBookingId}}/report-issue',
      headers: [H_JSON, asOwner(), roleOwner], body: { reason: 'Found a crack after closer inspection' },
      tests: [okTest('disputed'), `pm.test("status is disputed", function () { pm.expect(pm.response.json().booking.status).to.eql("disputed"); });`] }),
  ],
});

// ============================================================ 8. ADMIN RESOLVE
collection.item.push({
  name: '8. Admin resolves a dispute',
  item: [
    req({ name: 'Resolve outstanding disputed booking -> Completed with deduction', method: 'POST', path: '/api/bookings/{{issueBookingId}}/resolve',
      headers: [H_JSON, asAdmin(), roleAdmin],
      body: { outcome: 'completed', reason: 'Minor pre-existing wear, partial deduction agreed', deductionAmount: 15 },
      tests: [okTest('resolved'), `pm.test("status is completed", function () { pm.expect(pm.response.json().booking.status).to.eql("completed"); });`] }),
    req({ name: 'Resolve as non-admin (403)', method: 'POST', path: '/api/bookings/{{disputeBookingId}}/resolve',
      headers: [H_JSON, asOwner(), roleOwner], body: { outcome: 'completed', reason: 'x' },
      tests: [statusTest(403, 'non-admin blocked')] }),
    req({ name: 'Resolve with invalid outcome (400)', method: 'POST', path: '/api/bookings/{{disputeBookingId}}/resolve',
      headers: [H_JSON, asAdmin(), roleAdmin], body: { outcome: 'bogus', reason: 'x' },
      tests: [statusTest(400, 'invalid outcome rejected')] }),
    req({ name: 'Resolve the return-dispute booking -> Cancelled', method: 'POST', path: '/api/bookings/{{disputeBookingId}}/resolve',
      headers: [H_JSON, asAdmin(), roleAdmin], body: { outcome: 'cancelled', reason: 'Damage inconclusive, cancelling as goodwill' },
      tests: [okTest('resolved'), `pm.test("status is cancelled", function () { pm.expect(pm.response.json().booking.status).to.eql("cancelled"); });`] }),
  ],
});

// ============================================================ 9. DAILY JOB
collection.item.push({
  name: '9. Daily job (system transitions, time-travel)',
  item: [
    req({ name: 'Create booking (for pending expiry)', method: 'POST', path: '/api/bookings', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{startJ}}', endDate: '{{endJ}}' },
      preScript: `pm.variables.set("startJ", new Date(Date.now()+10*24*60*60*1000).toISOString());\npm.variables.set("endJ", new Date(Date.now()+12*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'created'), `pm.environment.set("expiryBookingId", pm.response.json().booking._id);`] }),
    req({ name: 'Run daily job (nothing eligible yet)', method: 'POST', path: '/api/dev/run-daily-job',
      headers: [H_JSON, asAdmin(), roleAdmin], tests: [okTest('ran'), `pm.test("nothing expired yet", function () { pm.expect(pm.response.json().summary.expired_pending).to.eql(0); });`] }),
    req({ name: 'Advance clock 49 hours (past the 48h pending-expiry default)', method: 'POST', path: '/api/dev/advance-clock',
      headers: [H_JSON, asAdmin(), roleAdmin], body: { minutes: 2940 }, tests: [okTest('advanced')] }),
    req({ name: 'Run daily job (now expires the ignored Pending)', method: 'POST', path: '/api/dev/run-daily-job',
      headers: [H_JSON, asAdmin(), roleAdmin],
      // >= 1, not exactly 1: earlier folders in this same run (e.g. folder 1's unapproved
      // booking, folder 3's rejected-by-overlap booking B) are also still legitimately
      // Pending by now and the job correctly expires all of them at once, not just ours.
      tests: [okTest('ran'), `pm.test("at least our booking expired", function () { pm.expect(pm.response.json().summary.expired_pending).to.be.at.least(1); });`] }),
    req({ name: 'Run daily job again (idempotent - nothing left to expire)', method: 'POST', path: '/api/dev/run-daily-job',
      headers: [H_JSON, asAdmin(), roleAdmin],
      tests: [okTest('ran'), `pm.test("no double-expiry", function () { pm.expect(pm.response.json().summary.expired_pending).to.eql(0); });`] }),
    req({ name: 'Check confirmed booking status', method: 'GET', path: '/api/bookings/{{expiryBookingId}}',
      headers: [asAdmin(), roleAdmin], tests: [okTest('fetched'), `pm.test("cancelled by system", function () { pm.expect(pm.response.json().booking.status).to.eql("cancelled"); });`] }),
    req({ name: 'Reset clock', method: 'POST', path: '/api/dev/reset-clock', headers: [H_JSON, asAdmin(), roleAdmin], tests: [okTest('reset')] }),
    req({ name: 'What time does the server think it is?', method: 'GET', path: '/api/dev/now', headers: [asAdmin(), roleAdmin], tests: [okTest('now')] }),
  ],
});

// ============================================================ 10. CART
collection.item.push({
  name: '10. Cart (add / view / remove / checkout)',
  item: [
    req({ name: 'View cart (starts empty)', method: 'GET', path: '/api/cart', headers: [asRenter(), roleRenter],
      tests: [okTest('fetched'), `pm.test("empty to start", function () { pm.expect(pm.response.json().cart.items.length).to.eql(0); });`] }),
    req({ name: 'Add item to cart', method: 'POST', path: '/api/cart/items', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId2}}', startDate: '{{cartStart}}', endDate: '{{cartEnd}}' },
      preScript: `pm.variables.set("cartStart", new Date(Date.now()+40*24*60*60*1000).toISOString());\npm.variables.set("cartEnd", new Date(Date.now()+42*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'added'),
        `pm.test("one item now in cart", function () { pm.expect(pm.response.json().cart.items.length).to.eql(1); });`,
        `pm.environment.set("cartItemId", pm.response.json().cart.items[0]._id);`] }),
    req({ name: 'Add your own equipment to cart (400)', method: 'POST', path: '/api/cart/items', headers: [H_JSON, asOwner(), roleOwner],
      body: { equipmentId: '{{equipmentId2}}', startDate: '{{cartStart}}', endDate: '{{cartEnd}}' },
      tests: [statusTest(400, 'cannot cart your own equipment')] }),
    req({ name: 'Add item overlapping an already-approved booking (409)', method: 'POST', path: '/api/cart/items', headers: [H_JSON, asOtherRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId}}', startDate: '{{bookingAStart}}', endDate: '{{bookingAEnd}}' },
      preScript: `pm.variables.set("bookingAStart", new Date(Date.now()+30*24*60*60*1000+3600000).toISOString());\npm.variables.set("bookingAEnd", new Date(Date.now()+32*24*60*60*1000).toISOString());`,
      tests: [statusTest(409, 'refused - equipmentId already has an approved booking from folder 3 covering these dates')] }),
    req({ name: 'View cart (now has one item)', method: 'GET', path: '/api/cart', headers: [asRenter(), roleRenter],
      tests: [okTest('fetched'), `pm.test("one item", function () { pm.expect(pm.response.json().cart.items.length).to.eql(1); });`] }),
    req({ name: 'Remove the item', method: 'DELETE', path: '/api/cart/items/{{cartItemId}}', headers: [asRenter(), roleRenter],
      tests: [okTest('removed'), `pm.test("cart empty again", function () { pm.expect(pm.response.json().cart.items.length).to.eql(0); });`] }),
    req({ name: 'Checkout an empty cart (400)', method: 'POST', path: '/api/cart/checkout', headers: [H_JSON, asRenter(), roleRenter],
      tests: [statusTest(400, 'empty cart refused')] }),
    req({ name: 'Add two items from different owners', method: 'POST', path: '/api/cart/items', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId3}}', startDate: '{{cartStart2}}', endDate: '{{cartEnd2}}' },
      preScript: `pm.variables.set("cartStart2", new Date(Date.now()+45*24*60*60*1000).toISOString());\npm.variables.set("cartEnd2", new Date(Date.now()+46*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'added')] }),
    req({ name: 'Add second item', method: 'POST', path: '/api/cart/items', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId5}}', startDate: '{{cartStart3}}', endDate: '{{cartEnd3}}' },
      preScript: `pm.variables.set("cartStart3", new Date(Date.now()+50*24*60*60*1000).toISOString());\npm.variables.set("cartEnd3", new Date(Date.now()+51*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'added')] }),
    req({ name: 'Checkout - both items become independent Pending bookings', method: 'POST', path: '/api/cart/checkout', headers: [H_JSON, asRenter(), roleRenter],
      tests: [statusTest(201, 'checked out'),
        `pm.test("two bookings created, cart now empty", function () {\n  var j = pm.response.json();\n  pm.expect(j.created.length).to.eql(2);\n  pm.expect(j.failed.length).to.eql(0);\n  pm.expect(j.cart.items.length).to.eql(0);\n});`] }),
  ],
});

// ============================================================ 11. CART RACE
collection.item.push({
  name: '11. Cart race (two renters, same equipment, overlapping dates)',
  item: [
    req({ name: 'Renter adds item to cart', method: 'POST', path: '/api/cart/items', headers: [H_JSON, asRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId6}}', startDate: '{{raceStartA}}', endDate: '{{raceEndA}}' },
      preScript: `pm.variables.set("raceStartA", new Date(Date.now()+60*24*60*60*1000).toISOString());\npm.variables.set("raceEndA", new Date(Date.now()+63*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'added')] }),
    req({ name: 'Other renter adds overlapping item to cart', method: 'POST', path: '/api/cart/items', headers: [H_JSON, asOtherRenter(), roleRenter],
      body: { equipmentId: '{{equipmentId6}}', startDate: '{{raceStartB}}', endDate: '{{raceEndB}}' },
      preScript: `pm.variables.set("raceStartB", new Date(Date.now()+61*24*60*60*1000).toISOString());\npm.variables.set("raceEndB", new Date(Date.now()+64*24*60*60*1000).toISOString());`,
      tests: [statusTest(201, 'added - overlapping a Pending cart item is fine, only confirmed bookings block')] }),
    req({ name: 'Renter checks out (becomes Pending)', method: 'POST', path: '/api/cart/checkout', headers: [H_JSON, asRenter(), roleRenter],
      tests: [statusTest(201, 'checked out'), `pm.environment.set("raceBookingA", pm.response.json().created[0]._id);`] }),
    req({ name: 'Other renter checks out (also becomes Pending - no conflict yet)', method: 'POST', path: '/api/cart/checkout', headers: [H_JSON, asOtherRenter(), roleRenter],
      tests: [statusTest(201, 'checked out'), `pm.environment.set("raceBookingB", pm.response.json().created[0]._id);`] }),
    req({ name: 'Owner approves A - this is the moment the race resolves', method: 'POST', path: '/api/bookings/{{raceBookingA}}/approve',
      headers: [H_JSON, asOwner(), roleOwner],
      tests: [okTest('A approved'),
        `pm.test("B was auto-rejected as a side effect", function () {\n  var ids = pm.response.json().autoRejectedConflictingBookingIds || [];\n  pm.expect(ids).to.include(pm.environment.get("raceBookingB"));\n});`] }),
    req({ name: "Confirm B's status - rejected, with a specific reason, no manual action needed", method: 'GET', path: '/api/bookings/{{raceBookingB}}',
      headers: [asAdmin(), roleAdmin],
      tests: [okTest('fetched'),
        `pm.test("rejected with a clear reason", function () {\n  var b = pm.response.json().booking;\n  pm.expect(b.status).to.eql("rejected");\n  pm.expect(b.rejectionReason).to.match(/overlapping dates/);\n});`] }),
    req({ name: 'Other renter sees why, even though they never asked', method: 'GET', path: '/api/notifications?unreadOnly=true',
      headers: [asOtherRenter(), roleRenter],
      tests: [okTest('fetched'),
        `pm.test("has the rejection notification", function () {\n  var n = pm.response.json().notifications;\n  pm.expect(n.some(function (x) { return x.bookingId === pm.environment.get("raceBookingB"); })).to.eql(true);\n});`] }),
  ],
});


collection.item.push({
  name: '12. Renter & owner dashboards',
  item: [
    req({ name: "Renter dashboard - brand new renter (should be all-empty)", method: 'GET', path: '/api/renters/{{otherRenterId}}/dashboard',
      headers: [asOtherRenter(), roleRenter],
      tests: [okTest('fetched'),
        `pm.test("zero everything for a fresh signup", function () {\n  var d = pm.response.json().dashboard;\n  pm.expect(d.upcoming.count).to.eql(0);\n  pm.expect(d.active.count).to.eql(0);\n  pm.expect(d.completed.count).to.eql(0);\n  pm.expect(d.totalSpent).to.eql(0);\n  pm.expect(d.overdue.count).to.eql(0);\n});`] }),
    req({ name: 'Renter dashboard - main renter (has bookings from earlier folders)', method: 'GET', path: '/api/renters/{{renterId}}/dashboard',
      headers: [asRenter(), roleRenter],
      tests: [okTest('fetched'),
        `pm.test("has at least one completed rental with spend", function () {\n  var d = pm.response.json().dashboard;\n  pm.expect(d.completed.count).to.be.at.least(1);\n  pm.expect(d.totalSpent).to.be.above(0);\n});`] }),
    req({ name: 'Renter dashboard - wrong renter viewing someone else\'s (403)', method: 'GET', path: '/api/renters/{{renterId}}/dashboard',
      headers: [asOtherRenter(), roleRenter], tests: [statusTest(403, 'blocked - not your dashboard')] }),
    req({ name: 'Renter dashboard - admin can view anyone\'s', method: 'GET', path: '/api/renters/{{renterId}}/dashboard',
      headers: [asAdmin(), roleAdmin], tests: [okTest('admin can view')] }),
    req({ name: 'Renter dashboard - unknown user id (404)', method: 'GET', path: '/api/renters/000000000000000000000000/dashboard',
      headers: [asAdmin(), roleAdmin], tests: [statusTest(404, 'unknown user')] }),

    req({ name: "Owner dashboard - brand new owner (should be all-empty)", method: 'GET', path: '/api/owners/{{otherOwnerId}}/dashboard',
      headers: [asOtherOwner(), roleOwner],
      tests: [okTest('fetched'),
        `pm.test("zero everything for a fresh signup", function () {\n  var d = pm.response.json().dashboard;\n  pm.expect(d.totalRequests).to.eql(0);\n  pm.expect(d.requestedProducts).to.be.an('array').that.is.empty;\n  pm.expect(d.inspectionsDue.count).to.eql(0);\n});`] }),
    req({ name: 'Owner dashboard - main owner (has requests/inspections from earlier folders)', method: 'GET', path: '/api/owners/{{ownerId}}/dashboard',
      headers: [asOwner(), roleOwner],
      tests: [okTest('fetched'),
        `pm.test("has at least one total request on record", function () {\n  var d = pm.response.json().dashboard;\n  pm.expect(d.totalRequests).to.be.at.least(1);\n});`] }),
    req({ name: 'Owner dashboard - wrong owner viewing someone else\'s (403)', method: 'GET', path: '/api/owners/{{ownerId}}/dashboard',
      headers: [asOtherOwner(), roleOwner], tests: [statusTest(403, 'blocked - not your dashboard')] }),
  ],
});

// ============================================================ 13. RENTER & OWNER BOOKING LISTS
collection.item.push({
  name: '13. Renter & owner booking lists (GET, filterable, paginated)',
  item: [
    req({ name: "Renter's full booking list", method: 'GET', path: '/api/renters/{{renterId}}/bookings',
      headers: [asRenter(), roleRenter],
      tests: [okTest('fetched'), `pm.test("has pagination info", function () { pm.expect(pm.response.json().pagination).to.have.property('total'); });`] }),
    req({ name: "Renter's bookings filtered by status", method: 'GET', path: '/api/renters/{{renterId}}/bookings?status=completed',
      headers: [asRenter(), roleRenter], tests: [okTest('fetched')] }),
    req({ name: "Renter's bookings, page 1 limit 1", method: 'GET', path: '/api/renters/{{renterId}}/bookings?page=1&limit=1',
      headers: [asRenter(), roleRenter],
      tests: [okTest('fetched'), `pm.test("exactly one result", function () { pm.expect(pm.response.json().bookings.length).to.be.at.most(1); });`] }),
    req({ name: "Wrong renter viewing someone else's list (403)", method: 'GET', path: '/api/renters/{{renterId}}/bookings',
      headers: [asOtherRenter(), roleRenter], tests: [statusTest(403, 'blocked')] }),
    req({ name: "Owner's full booking list", method: 'GET', path: '/api/owners/{{ownerId}}/bookings',
      headers: [asOwner(), roleOwner], tests: [okTest('fetched')] }),
    req({ name: "Wrong owner viewing someone else's list (403)", method: 'GET', path: '/api/owners/{{ownerId}}/bookings',
      headers: [asOtherOwner(), roleOwner], tests: [statusTest(403, 'blocked')] }),
  ],
});

// ============================================================ 14. ADMIN MONITORING
collection.item.push({
  name: '14. Admin monitoring (every booking, every user)',
  item: [
    req({ name: 'Non-admin tries to view all bookings (403)', method: 'GET', path: '/api/admin/bookings',
      headers: [asRenter(), roleRenter], tests: [statusTest(403, 'admin only')] }),
    req({ name: 'Admin sees every booking across every user', method: 'GET', path: '/api/admin/bookings',
      headers: [asAdmin(), roleAdmin],
      tests: [okTest('fetched'), `pm.test("has at least one booking on record", function () { pm.expect(pm.response.json().pagination.total).to.be.above(0); });`] }),
    req({ name: 'Admin filters by status', method: 'GET', path: '/api/admin/bookings?status=rejected',
      headers: [asAdmin(), roleAdmin], tests: [okTest('fetched')] }),
    req({ name: 'Admin filters by a specific owner', method: 'GET', path: '/api/admin/bookings?ownerId={{ownerId}}',
      headers: [asAdmin(), roleAdmin],
      tests: [okTest('fetched'), `pm.test("every result belongs to that owner", function () {\n  var items = pm.response.json().bookings;\n  items.forEach(function (b) { pm.expect(b.ownerId).to.eql(pm.environment.get("ownerId")); });\n});`] }),
  ],
});

// ============================================================ 15. NOTIFICATIONS
collection.item.push({
  name: '15. Notifications',
  item: [
    req({ name: "Winning renter's notifications (should be empty - nothing unusual happened to them)", method: 'GET', path: '/api/notifications',
      headers: [asRenter(), roleRenter], tests: [okTest('fetched')] }),
    req({ name: "Losing renter's notifications (has the auto-rejection from folder 11)", method: 'GET', path: '/api/notifications',
      headers: [asOtherRenter(), roleRenter],
      tests: [okTest('fetched'),
        `pm.test("at least one notification, unread", function () {\n  var j = pm.response.json();\n  pm.expect(j.notifications.length).to.be.at.least(1);\n  pm.expect(j.unreadCount).to.be.at.least(1);\n  pm.environment.set("notificationId", j.notifications[0]._id);\n});`] }),
    req({ name: 'Mark it read', method: 'POST', path: '/api/notifications/{{notificationId}}/read',
      headers: [H_JSON, asOtherRenter(), roleRenter],
      tests: [okTest('marked'), `pm.test("now read", function () { pm.expect(pm.response.json().notification.read).to.eql(true); });`] }),
    req({ name: 'Filter to unread only (now excludes the one just marked read)', method: 'GET', path: '/api/notifications?unreadOnly=true',
      headers: [asOtherRenter(), roleRenter], tests: [okTest('fetched')] }),
    req({ name: "Cannot mark someone else's notification read (404)", method: 'POST', path: '/api/notifications/{{notificationId}}/read',
      headers: [H_JSON, asRenter(), roleRenter], tests: [statusTest(404, 'not found for this user')] }),
  ],
});

// ============================================================ 16. HISTORY & ERRORS
collection.item.push({
  name: '16. History & error cases',
  item: [
    req({ name: 'Get booking history', method: 'GET', path: '/api/bookings/{{bookingId}}/history',
      headers: [asRenter(), roleRenter], tests: [okTest('history fetched'),
        `pm.test("history is an array with entries", function () { pm.expect(pm.response.json().history.length).to.be.above(0); });`] }),
    req({ name: 'No auth header at all (401)', method: 'POST', path: '/api/bookings', headers: [H_JSON], body: {},
      tests: [statusTest(401, 'unauthenticated request blocked')] }),
    req({ name: 'Unknown booking id (404)', method: 'POST', path: '/api/bookings/000000000000000000000000/approve',
      headers: [H_JSON, asOwner(), roleOwner], tests: [statusTest(404, 'unknown booking')] }),
    req({ name: 'Malformed booking id (400)', method: 'GET', path: '/api/bookings/not-a-valid-id',
      headers: [asOwner(), roleOwner], tests: [statusTest(400, 'bad id format')] }),
  ],
});

fs.writeFileSync(__dirname + '/RentIt-Lifecycle.postman_collection.json', JSON.stringify(collection, null, 2));

const environment = {
  id: 'rentit-lifecycle-env',
  name: 'RentIt Lifecycle - Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:4000', enabled: true },
    { key: 'renterId', value: '', enabled: true },
    { key: 'ownerId', value: '', enabled: true },
    { key: 'adminId', value: '', enabled: true },
    { key: 'otherOwnerId', value: '', enabled: true },
    { key: 'otherRenterId', value: '', enabled: true },
    { key: 'equipmentId', value: '', enabled: true },
    { key: 'equipmentId2', value: '', enabled: true },
    { key: 'equipmentId3', value: '', enabled: true },
    { key: 'equipmentId4', value: '', enabled: true },
    { key: 'equipmentId5', value: '', enabled: true },
    { key: 'equipmentId6', value: '', enabled: true },
    { key: 'equipmentId7', value: '', enabled: true },
    { key: 'otherEquipmentId', value: '', enabled: true },
    { key: 'bookingId', value: '', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};
fs.writeFileSync(__dirname + '/RentIt-Lifecycle.postman_environment.json', JSON.stringify(environment, null, 2));
console.log('Collection items:', collection.item.length);
