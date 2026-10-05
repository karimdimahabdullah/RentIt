import mongoose from 'mongoose';
const { Schema } = mongoose;

const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  type: { type: String, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.models.Notification || mongoose.model('Notification', schema);
