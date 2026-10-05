import mongoose from 'mongoose';
const { Schema } = mongoose;

const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  revieweeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerRole: { type: String, enum: ['renter', 'owner'], required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
}, { timestamps: true });

// once per person per booking - enforced by the database, not just the route
schema.index({ bookingId: 1, reviewerId: 1 }, { unique: true });

export default mongoose.models.Review || mongoose.model('Review', schema);
