/**
 * MINIMAL Equipment model - see note in User.js. The lifecycle only needs
 * {ownerId, pricePerDay, depositAmount}.
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  pricePerDay: { type: Number, default: 0 },
  depositAmount: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
}, { timestamps: true });

export default mongoose.models.Equipment || mongoose.model('Equipment', schema);
