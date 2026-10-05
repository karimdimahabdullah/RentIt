/**
 * Tiny per-equipment mutex so "two approvals race for the same dates" cannot both
 * pass the overlap check before either writes. FerretDB/standalone Mongo in this
 * project don't reliably give us multi-document transactions, so approval-time
 * safety comes from BOTH this lock AND the atomic conditional update in
 * bookingController.approve (belt and suspenders).
 *
 * NOTE (flagged in the README): this is a single-process mutex backed by a
 * document's unique _id. It is NOT a distributed lock - see README section on
 * scaling risk before running more than one instance of this app.
 */
import LockModel from '../models/Lock.js';

export async function withLock(key, ttlMs, fn) {
  const _id = `lock:${key}`;
  const now = Date.now();
  try {
    await LockModel.create({ _id, expiresAt: now + ttlMs });
  } catch (e) {
    const existing = await LockModel.findById(_id);
    if (existing && existing.expiresAt > now) {
      throw Object.assign(new Error('Another request is processing this equipment, try again'), { status: 409, code: 'LOCKED' });
    }
    await LockModel.findByIdAndUpdate(_id, { expiresAt: now + ttlMs }, { upsert: true });
  }
  try {
    return await fn();
  } finally {
    await LockModel.deleteOne({ _id });
  }
}
