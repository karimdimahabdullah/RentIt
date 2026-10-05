/**
 * THE SWAP-OUT INTEGRATION POINT.
 *
 * This is the one function that turns "a list of items someone wants to
 * rent" into real Pending bookings. It knows nothing about carts - it takes
 * a plain array of { equipmentId, startDate, endDate } and a renterId, and
 * nothing else. That's deliberate: our own Cart model (models/Cart.js) is
 * just ONE possible source of that array.
 *
 * IF YOUR TEAM BUILDS A SEPARATE CART SYSTEM LATER, you do not need to touch
 * this file, services/bookingService.js, or anything else the lifecycle owns.
 * You only need to:
 *   1. Map their cart item's fields onto { equipmentId, startDate, endDate }
 *      (rename/reshape whatever they call them - e.g. their `itemId`/`from`/
 *      `to` becomes our `equipmentId`/`startDate`/`endDate`).
 *   2. Call `checkoutItems(renterId, mappedItems)` from wherever their
 *      checkout flow lives.
 * Everything downstream - overlap checks, booking creation, per-item success/
 * failure reporting - is already handled here. Our controllers/cartController.js
 * is nothing more than a reference implementation of step 1 for our own Cart
 * model; delete it (and models/Cart.js, routes/cartRoutes.js) once the real
 * cart system exists, if you don't want to keep it around for testing.
 *
 * Every item is processed independently - one failing (equipment deleted,
 * dates now conflict with something approved since it was added, etc.) never
 * blocks the others, because in a multi-owner marketplace there is no single
 * "order" to roll back; each item's booking lives its own lifecycle with its
 * own owner.
 */
import { createBookingForRenter } from './bookingService.js';

/**
 * @param {string} renterId
 * @param {Array<{equipmentId: string, startDate: string|Date, endDate: string|Date, itemId?: string}>} items
 * @returns {Promise<{created: Array, failed: Array<{item: object, error: string}>}>}
 */
export async function checkoutItems(renterId, items) {
  const created = [];
  const failed = [];
  for (const item of items) {
    try {
      const booking = await createBookingForRenter(renterId, item);
      created.push(booking);
    } catch (e) {
      failed.push({ item, error: e.message || 'Could not create this booking' });
    }
  }
  return { created, failed };
}
