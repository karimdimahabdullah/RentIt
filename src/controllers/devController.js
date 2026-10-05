/**
 * Testing-only controllers (plan sections 6 & 7): seed demo data, run the daily
 * job on demand, and move the clock, so expiry/overdue/auto-confirm can be
 * tested in one Postman session instead of over several real days.
 *
 * Gated by settings().enableDevRoutes (env ENABLE_DEV_ROUTES=true) at the route
 * level (see routes/devRoutes.js) - MUST be off in production.
 */
import User from '../models/User.js';
import Equipment from '../models/Equipment.js';
import Booking from '../models/Booking.js';
import BookingHistory from '../models/BookingHistory.js';
import LifecycleTransaction from '../models/LifecycleTransaction.js';
import OwnerBalance from '../models/OwnerBalance.js';
import Lock from '../models/Lock.js';
import { runDailyJob } from '../services/dailyJob.js';
import * as clock from '../services/clock.js';

/**
 * POSTMAN CONVENIENCE ONLY. Wipes lifecycle collections and creates a fixed set
 * of demo users + equipment, so the Postman collection can run end-to-end
 * without depending on the rest of the team's User/Equipment routes.
 * Delete this route once the real registration endpoints exist.
 */
export async function seed(req, res, next) {
  try {
    await Promise.all([
      Booking.deleteMany({}), BookingHistory.deleteMany({}), LifecycleTransaction.deleteMany({}),
      OwnerBalance.deleteMany({}), Lock.deleteMany({}), User.deleteMany({}), Equipment.deleteMany({}),
    ]);
    clock.reset();
    const [renter, owner, admin, otherOwner, otherRenter] = await Promise.all([
      User.create({ firstName: 'Rae', lastName: 'Renter', email: 'renter@rentit.test', role: 'renter' }),
      User.create({ firstName: 'Oli', lastName: 'Owner', email: 'owner@rentit.test', role: 'owner' }),
      User.create({ firstName: 'Ada', lastName: 'Admin', email: 'admin@rentit.test', role: 'admin' }),
      User.create({ firstName: 'Ozzy', lastName: 'OtherOwner', email: 'otherowner@rentit.test', role: 'owner' }),
      User.create({ firstName: 'Remi', lastName: 'OtherRenter', email: 'otherrenter@rentit.test', role: 'renter' }),
    ]);
    const equipment = await Equipment.create({ ownerId: owner._id, title: 'Generator 5000W', pricePerDay: 100, depositAmount: 50 });
    const otherEquipment = await Equipment.create({ ownerId: otherOwner._id, title: 'Excavator', pricePerDay: 400, depositAmount: 200 });
    const scratch = await Equipment.insertMany([
      { ownerId: owner._id, title: 'Pressure Washer', pricePerDay: 40, depositAmount: 20 },
      { ownerId: owner._id, title: 'Chainsaw', pricePerDay: 35, depositAmount: 25 },
      { ownerId: owner._id, title: 'Cement Mixer', pricePerDay: 60, depositAmount: 30 },
      { ownerId: owner._id, title: 'Scaffold Tower', pricePerDay: 80, depositAmount: 50 },
      { ownerId: owner._id, title: 'Tile Cutter', pricePerDay: 25, depositAmount: 15 },
      { ownerId: owner._id, title: 'Concrete Vibrator', pricePerDay: 30, depositAmount: 20 },
    ]);
    res.json({
      renterId: renter._id, ownerId: owner._id, adminId: admin._id,
      otherOwnerId: otherOwner._id, otherRenterId: otherRenter._id,
      equipmentId: equipment._id, otherEquipmentId: otherEquipment._id,
      equipmentId2: scratch[0]._id, equipmentId3: scratch[1]._id, equipmentId4: scratch[2]._id,
      equipmentId5: scratch[3]._id, equipmentId6: scratch[4]._id, equipmentId7: scratch[5]._id,
    });
  } catch (e) { next(e); }
}

export async function runJobNow(req, res, next) {
  try {
    const at = req.body.at ? new Date(req.body.at) : undefined;
    const summary = await runDailyJob({ at });
    res.json({ summary });
  } catch (e) { next(e); }
}

export function advanceClock(req, res) {
  const minutes = Number(req.body.minutes);
  if (!Number.isFinite(minutes)) return res.status(400).json({ error: 'minutes must be a number' });
  const offsetMs = clock.advance(minutes * 60 * 1000);
  res.json({ now: clock.now(), offsetMs });
}

export function resetClock(req, res) { clock.reset(); res.json({ now: clock.now() }); }
export function whatTimeIsIt(req, res) { res.json({ now: clock.now() }); }
