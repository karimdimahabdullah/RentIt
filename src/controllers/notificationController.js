import Notification from '../models/Notification.js';
import { notFound } from '../utils/errors.js';

export async function listMine(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const filter = { userId: req.user.id };
    if (req.query.unreadOnly === 'true') filter.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: req.user.id, read: false }),
    ]);
    res.json({ notifications, unreadCount, pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (e) { next(e); }
}

export async function markRead(req, res, next) {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { read: true } },
      { returnDocument: 'after' },
    );
    if (!notification) return next(notFound('Notification not found'));
    res.json({ notification });
  } catch (e) { next(e); }
}
