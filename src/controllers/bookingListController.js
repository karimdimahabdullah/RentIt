/**
 * List endpoints - the GET side of things. POST responses only tell you the
 * result of the one action you just took; they can't tell a renter "here's
 * everything currently going on with my rentals" on page load, or after
 * something changed because of someone ELSE's action (see approve()'s
 * auto-reject-conflicting side effect - the losing renter never sent a
 * request at that moment, so there's no POST response for them to read it
 * from). These endpoints exist so a frontend can always ask "what's the
 * current state?" independent of whatever action last happened.
 */
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { forbidden, notFound } from '../utils/errors.js';

export async function paginatedList(filter, query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const [bookings, total] = await Promise.all([
    Booking.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Booking.countDocuments(filter),
  ]);
  return { bookings, pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function listForRenter(req, res, next) {
  try {
    const { userId } = req.params;
    const uid = String(req.user.id);
    if (req.user.role !== 'admin' && uid !== String(userId)) return next(forbidden('You can only view your own bookings'));
    const user = await User.findById(userId);
    if (!user) return next(notFound('User not found'));

    const filter = { renterId: userId };
    if (req.query.status) filter.status = req.query.status;
    res.json(await paginatedList(filter, req.query));
  } catch (e) { next(e); }
}

export async function listForOwner(req, res, next) {
  try {
    const { userId } = req.params;
    const uid = String(req.user.id);
    if (req.user.role !== 'admin' && uid !== String(userId)) return next(forbidden('You can only view your own bookings'));
    const user = await User.findById(userId);
    if (!user) return next(notFound('User not found'));

    const filter = { ownerId: userId };
    if (req.query.status) filter.status = req.query.status;
    res.json(await paginatedList(filter, req.query));
  } catch (e) { next(e); }
}
