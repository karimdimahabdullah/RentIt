/**
 * Booking model - a SUPERSET of the Bookings collection in the system design
 * (renterId, ownerId, equipmentId, startDate, endDate, status, timestamps).
 * If your team already has a Booking model, merge these extra fields into it
 * (or replace it with this file) - mongoose strict mode silently drops unknown fields.
 */
import mongoose from 'mongoose';
import { ALL_STATUSES, STATUS } from '../services/statuses.js';
import * as clock from '../services/clock.js';
const { Schema } = mongoose;

const condition = new Schema({
  notes: { type: String, trim: true },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  at: Date,
}, { _id: false });

const bookingSchema = new Schema({
  renterId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ownerId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // snapshot of equipment owner
  equipmentId: { type: Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  startDate:   { type: Date, required: true },
  endDate:     { type: Date, required: true },
  status:      { type: String, enum: ALL_STATUSES, default: STATUS.PENDING, index: true },
  statusChangedAt: Date,
  requestedAt: { type: Date, default: () => clock.now() },

  // ---- money ----
  dailyRate:      { type: Number, required: true, min: 0 },
  rentalAmount:   { type: Number, required: true, min: 0 },
  depositAmount:  { type: Number, required: true, min: 0 },
  amountPaid:     { type: Number, default: 0, min: 0 },    // rental + deposit actually paid (demo payment)
  depositHeld:    { type: Number, default: 0, min: 0 },    // deposit currently held by the platform
  refundedAmount: { type: Number, default: 0, min: 0 },
  lateFeeAccrued: { type: Number, default: 0, min: 0 },

  // ---- lifecycle facts ----
  approvedAt: Date,
  rejectedAt: Date,
  rejectionReason: String,
  cancelledAt: Date,
  cancelledBy: { type: String, enum: ['renter', 'owner', 'system'] },
  cancellationReason: String,
  renterPenalty: { amount: Number, tier: String },          // renter late-cancel penalty
  ownerPenalty:  { amount: Number, tier: String },          // owner cancel penalty (recorded as a debt)

  pickedUpAt: Date,
  pickupCondition: condition,

  noShowAt: Date,
  noShowPenalty: { type: Number, default: 0 },
  noShowDisputedAt: Date,

  overdueAt: Date,
  lastLateFeeAccrualAt: Date,
  returnClaimedAt: Date,
  returnClaimNotes: String,
  returnedAt: Date,
  returnConfirmedBy: { type: String, enum: ['owner', 'system'] },
  returnCondition: condition,

  disputedAt: Date,
  disputedFrom: { type: String, enum: ['approved', 'no_show', 'return_claimed', 'overdue', 'returned'] },
  disputeReason: String,
  disputeOpenedBy: { type: String, enum: ['renter', 'owner', 'system'] },

  completedAt: Date,
  resolution: {
    outcome: String, reason: String, notes: String, resolvedBy: Schema.Types.ObjectId, resolvedAt: Date,
    deductionAmount: Number, penaltyAmount: Number,
  },
}, { timestamps: true });

bookingSchema.index({ equipmentId: 1, status: 1, startDate: 1, endDate: 1 });

export default mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
