/**
 * MINIMAL User model. If your project already has a fuller one (auth fields,
 * profile image, etc. - see the Users collection in the system design), merge
 * these fields into it and delete this file; the lifecycle only needs
 * {role, isActive}. Registered defensively (mongoose.models.User || ...) so
 * loading this file twice, or after your real model, never throws.
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

const schema = new Schema({
  firstName: String,
  lastName: String,
  email: { type: String, unique: true, sparse: true },
  role: { type: String, enum: ['renter', 'owner', 'admin'], default: 'renter' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model('User', schema);
