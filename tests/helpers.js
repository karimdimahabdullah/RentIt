import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';
import Equipment from '../src/models/Equipment.js';
import Booking from '../src/models/Booking.js';
import BookingHistory from '../src/models/BookingHistory.js';
import LifecycleTransaction from '../src/models/LifecycleTransaction.js';
import OwnerBalance from '../src/models/OwnerBalance.js';
import Lock from '../src/models/Lock.js';
import * as clock from '../src/services/clock.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect('mongodb://127.0.0.1:27017/rentit_test');
  }
}

export async function wipe() {
  await Promise.all([
    User.deleteMany({}), Equipment.deleteMany({}), Booking.deleteMany({}),
    BookingHistory.deleteMany({}), LifecycleTransaction.deleteMany({}),
    OwnerBalance.deleteMany({}), Lock.deleteMany({}),
  ]);
  clock.reset();
}

export function token(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, SECRET);
}
export function bearer(user) { return { Authorization: `Bearer ${token(user)}` }; }

export async function makeUsers() {
  const renter = await User.create({ firstName: 'Rae', lastName: 'Renter', email: `renter${Date.now()}${Math.random()}@t.com`, role: 'renter' });
  const owner = await User.create({ firstName: 'Oli', lastName: 'Owner', email: `owner${Date.now()}${Math.random()}@t.com`, role: 'owner' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: `admin${Date.now()}${Math.random()}@t.com`, role: 'admin' });
  const otherOwner = await User.create({ firstName: 'Ozzy', lastName: 'Other', email: `other${Date.now()}${Math.random()}@t.com`, role: 'owner' });
  const otherRenter = await User.create({ firstName: 'Remi', lastName: 'Other', email: `rrenter${Date.now()}${Math.random()}@t.com`, role: 'renter' });
  return { renter, owner, admin, otherOwner, otherRenter };
}

export async function makeEquipment(owner, overrides = {}) {
  return Equipment.create({ ownerId: owner._id, title: 'Generator', pricePerDay: 100, depositAmount: 50, ...overrides });
}

export function daysFromNow(n) { return new Date(clock.now().getTime() + n * 24 * 60 * 60 * 1000); }
export function minsFromNow(n) { return new Date(clock.now().getTime() + n * 60 * 1000); }

export { clock };
