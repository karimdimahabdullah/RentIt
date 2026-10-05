/**
 * Money movements created by the lifecycle. Kept in its own collection so it cannot
 * collide with your team's demo-payment Transaction model. To merge later, change
 * only this file (and ledger.js).
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

const TYPES = [
  'refund',               // money back to the renter (cancellation / no-show remainder)
  'deposit_release',      // deposit returned at Completed
  'renter_penalty',       // renter late-cancel penalty
  'no_show_penalty',
  'owner_penalty_debt',   // owner cancellation penalty, owed
  'compensation',         // owner penalty credited to renter
  'penalty_reversal',     // admin reversed a no-show penalty
  'deduction',            // late fee / damage taken from the deposit
  'owner_earning',
  'renter_debt',          // deduction larger than the deposit
];

const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  renterId: { type: Schema.Types.ObjectId, ref: 'User' },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: TYPES, required: true },
  party: { type: String, enum: ['renter', 'owner', 'platform'] },
  amount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['completed', 'owed', 'settled', 'waived'], default: 'completed' },
  settledAmount: { type: Number, default: 0 },
  waivedAmount: { type: Number, default: 0 },
  reason: String,
  reference: { type: String, required: true, unique: true },
  meta: Schema.Types.Mixed,
}, { timestamps: true });

const Model = mongoose.models.LifecycleTransaction || mongoose.model('LifecycleTransaction', schema);
export default Model;
export { TYPES };
