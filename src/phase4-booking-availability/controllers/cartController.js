/**
 * Reference cart implementation - add/remove/view/clear + checkout. See the
 * big comment at the top of services/checkoutService.js for how this fits
 * together with the actual lifecycle: checkout here does nothing but read
 * this cart's items and hand them to checkoutService.checkoutItems(), which
 * is the part that matters if this whole file ever gets replaced.
 */
import Cart from '../models/Cart.js';
import Equipment from '../../models/Equipment.js';
import { hasOverlap } from '../../services/overlap.js';
import { checkoutItems } from '../services/checkoutService.js';
import { badRequest, notFound, conflict } from '../../utils/errors.js';
import * as clock from '../../services/clock.js';

const MAX_CART_ITEMS = 20;

export async function viewCart(req, res, next) {
  try {
    const cart = await Cart.findOne({ userId: req.user.id });
    res.json({ cart: cart ? cart : { userId: req.user.id, items: [] } });
  } catch (e) { next(e); }
}

export async function addItem(req, res, next) {
  try {
    const { equipmentId, startDate, endDate } = req.body;
    if (!equipmentId || !startDate || !endDate) return next(badRequest('equipmentId, startDate and endDate are required'));
    const start = new Date(startDate), end = new Date(endDate);
    if (!(start < end)) return next(badRequest('endDate must be after startDate'));
    if (start.getTime() < clock.now().getTime() - 60 * 1000) return next(badRequest('startDate cannot be in the past'));

    const equipment = await Equipment.findById(equipmentId);
    if (!equipment) return next(notFound('Equipment not found'));
    if (String(equipment.ownerId) === String(req.user.id)) return next(badRequest('You cannot add your own equipment to your cart'));

    // Refuse up front if this equipment is already confirmed-booked for these
    // dates - same rule as booking creation (services/bookingService.js), so
    // a renter never wastes a cart slot on something that could never work.
    // This deliberately does NOT check against other users' PENDING requests
    // or cart contents - those are provisional by design; only a CONFIRMED
    // (blocking-status) booking disqualifies a date range. See
    // services/overlap.js for what counts as blocking.
    const taken = await hasOverlap({ equipmentId, startDate: start, endDate: end });
    if (taken) return next(conflict('This equipment is already booked for these dates - pick different dates or equipment'));

    let cart = await Cart.findOne({ userId: req.user.id });
    if (!cart) cart = new Cart({ userId: req.user.id, items: [] });
    if (cart.items.length >= MAX_CART_ITEMS) return next(badRequest(`Your cart is full (max ${MAX_CART_ITEMS} items) - remove something before adding more`));

    cart.items.push({ equipmentId, startDate: start, endDate: end, addedAt: clock.now() });
    await cart.save();
    res.status(201).json({ cart });
  } catch (e) { next(e); }
}

export async function removeItem(req, res, next) {
  try {
    const cart = await Cart.findOne({ userId: req.user.id });
    if (!cart) return next(notFound('Cart not found'));
    const before = cart.items.length;
    cart.items = cart.items.filter((i) => String(i._id) !== req.params.itemId);
    if (cart.items.length === before) return next(notFound('No such item in your cart'));
    await cart.save();
    res.json({ cart });
  } catch (e) { next(e); }
}

export async function clearCart(req, res, next) {
  try {
    await Cart.findOneAndUpdate({ userId: req.user.id }, { $set: { items: [] } });
    res.json({ cart: { userId: req.user.id, items: [] } });
  } catch (e) { next(e); }
}

/**
 * Turn every item currently in the cart into an independent Pending booking.
 * Each item is processed on its own - one failing (equipment deleted since it
 * was added, dates got taken by someone else in the meantime, etc.) does not
 * block the others, because each becomes a booking with its own owner and its
 * own lifecycle. Failed items are left in the cart so the renter can see what
 * didn't go through and fix it (different dates, remove it, etc.); successful
 * items are removed from the cart since they're now real bookings.
 */
export async function checkout(req, res, next) {
  try {
    const cart = await Cart.findOne({ userId: req.user.id });
    if (!cart || cart.items.length === 0) return next(badRequest('Your cart is empty'));

    const itemsToProcess = cart.items.map((i) => ({
      itemId: i._id, equipmentId: i.equipmentId, startDate: i.startDate, endDate: i.endDate,
    }));
    const { created, failed } = await checkoutItems(req.user.id, itemsToProcess);

    // Keep only the failed items in the cart; drop the ones that succeeded.
    const failedItemIds = new Set(failed.map((f) => String(f.item.itemId)));
    cart.items = cart.items.filter((i) => failedItemIds.has(String(i._id)));
    await cart.save();

    res.status(created.length ? 201 : 400).json({
      created,
      failed: failed.map((f) => ({ itemId: f.item.itemId, equipmentId: f.item.equipmentId, error: f.error })),
      cart,
    });
  } catch (e) { next(e); }
}
