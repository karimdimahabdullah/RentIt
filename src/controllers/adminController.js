/**
 * Admin visibility over EVERY booking, from every user, at any lifecycle
 * stage - "monitor the complete lifecycle for bookings from all users."
 * Filter by any combination of status/renter/owner/equipment; unfiltered
 * returns everything, paginated, most-recently-updated first.
 */
import { paginatedList } from './bookingListController.js';

export async function listAllBookings(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.renterId) filter.renterId = req.query.renterId;
    if (req.query.ownerId) filter.ownerId = req.query.ownerId;
    if (req.query.equipmentId) filter.equipmentId = req.query.equipmentId;
    res.json(await paginatedList(filter, req.query));
  } catch (e) { next(e); }
}
