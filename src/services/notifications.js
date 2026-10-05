/**
 * The one place that writes a Notification. This exists specifically for
 * events the AFFECTED user did not cause themselves - e.g. their pending
 * request got auto-rejected because someone else's overlapping request was
 * approved first. There is no POST response for that renter to read this
 * from (they didn't send a request at that moment), so it has to live
 * somewhere they can fetch it: GET /api/notifications.
 */
import Notification from '../models/Notification.js';

export async function notify({ userId, bookingId, type, message }) {
  return Notification.create({ userId, bookingId, type, message });
}
