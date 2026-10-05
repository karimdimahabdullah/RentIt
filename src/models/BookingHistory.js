import mongoose from 'mongoose';
const { Schema } = mongoose;

// Who, when, from, to, why - the evidence trail for every dispute.
const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  from: String,
  to: String,
  action: { type: String, required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole: { type: String, enum: ['renter', 'owner', 'admin', 'system'], required: true },
  reason: String,
  notes: String,
  meta: Schema.Types.Mixed,
  at: { type: Date, required: true },
}, { timestamps: false });

export default mongoose.models.BookingHistory || mongoose.model('BookingHistory', schema);
