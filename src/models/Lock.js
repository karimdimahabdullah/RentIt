import mongoose from 'mongoose';
const { Schema } = mongoose;

// Tiny per-equipment mutex. _id is unique, so a second insert fails while a lock is held.
const schema = new Schema({
  _id: String,
  expiresAt: { type: Number, required: true },   // real epoch ms (not the test clock)
}, { versionKey: false });

export default mongoose.models.Lock || mongoose.model('Lock', schema);
