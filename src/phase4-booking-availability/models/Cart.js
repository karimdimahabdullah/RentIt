/**
 * One cart document per user (upserted, not created at signup - same
 * "nothing to initialize" philosophy as the dashboards: a user with no cart
 * yet just gets an empty one back from GET /api/cart, no row created until
 * they actually add something).
 *
 * This is a REFERENCE implementation for testing the lifecycle's checkout
 * path (see services/checkoutService.js for the actual integration point).
 * If your team builds a separate cart system, this model - along with
 * controllers/cartController.js and routes/cartRoutes.js - can be deleted
 * entirely without touching anything else.
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

const cartItemSchema = new Schema({
  equipmentId: { type: Schema.Types.ObjectId, ref: 'Equipment', required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  addedAt: { type: Date, required: true },
});

const cartSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  items: { type: [cartItemSchema], default: [] },
}, { timestamps: true });

export default mongoose.models.Cart || mongoose.model('Cart', cartSchema);
