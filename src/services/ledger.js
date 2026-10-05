/**
 * All money-movement helpers. Every write here is deterministic and idempotent
 * per booking+type via a stable `reference`, so a retried request (or a daily
 * job that runs twice) can never double-refund or double-charge.
 */
import crypto from 'crypto';
import Transaction from '../models/LifecycleTransaction.js';
import OwnerBalance from '../models/OwnerBalance.js';

export const ref = (bookingId, type, salt = '') =>
  crypto.createHash('sha256').update(`${bookingId}:${type}:${salt}`).digest('hex').slice(0, 24);

export async function record({ session, bookingId, renterId, ownerId, type, party, amount, status = 'completed', reason, salt, meta }) {
  amount = Math.round(amount * 100) / 100;
  if (amount <= 0) return null;
  const reference = ref(bookingId, type, salt);
  const existing = await Transaction.findOne({ reference }).session(session);
  if (existing) return existing; // idempotent - already recorded
  const [doc] = await Transaction.create([{
    bookingId, renterId, ownerId, type, party, amount, status, reason, reference, meta,
  }], { session });
  return doc;
}

export async function adjustOwnerBalance(ownerId, delta, { earned = 0, debt = 0 } = {}, session) {
  await OwnerBalance.findOneAndUpdate(
    { ownerId },
    { $inc: { balance: delta, totalEarned: earned, totalDebts: debt }, $setOnInsert: { ownerId } },
    { upsert: true, session },
  );
}
