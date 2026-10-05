import mongoose from 'mongoose';
const { Schema } = mongoose;

// Running balance per owner = earnings - debts. Payouts are calculated from it.
const schema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  totalDebts: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.models.OwnerBalance || mongoose.model('OwnerBalance', schema);
