/**
 * Phase-agnostic reads. A single booking's current status, and its full
 * history, are useful to Phase 4 (renter/owner checking a pending request)
 * and Phase 5 (renter/owner/admin watching it move through the lifecycle)
 * equally - these don't belong to either phase folder, they're generic
 * read access over the one shared Booking document.
 */
import Booking from '../models/Booking.js';
import BookingHistory from '../models/BookingHistory.js';
import { notFound, forbidden } from '../utils/errors.js';

export async function getBooking(req, res, next) {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return next(notFound('Booking not found'));
    const uid = String(req.user.id);
    const allowed = req.user.role === 'admin' || uid === String(booking.renterId) || uid === String(booking.ownerId);
    if (!allowed) return next(forbidden());
    res.json({ booking });
  } catch (e) { next(e); }
}

export async function getHistory(req, res, next) {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return next(notFound('Booking not found'));
    const uid = String(req.user.id);
    const allowed = req.user.role === 'admin' || uid === String(booking.renterId) || uid === String(booking.ownerId);
    if (!allowed) return next(forbidden());
    const events = await BookingHistory.find({ bookingId: booking._id }).sort({ at: 1 });
    res.json({ history: events });
  } catch (e) { next(e); }
}
