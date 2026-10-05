import BookingHistory from '../models/BookingHistory.js';

export async function record({ session, bookingId, from, to, action, actorId, actorRole, reason, notes, meta, at }) {
  const [doc] = await BookingHistory.create([{
    bookingId, from, to, action, actorId: actorId || null, actorRole, reason, notes, meta, at,
  }], { session });
  return doc;
}
