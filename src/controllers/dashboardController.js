import User from '../models/User.js';
import { getRenterDashboard, getOwnerDashboard } from '../services/dashboardService.js';
import { forbidden, notFound, badRequest } from '../utils/errors.js';

export async function renterDashboard(req, res, next) {
  try {
    const { userId } = req.params;
    const uid = String(req.user.id);
    if (req.user.role !== 'admin' && uid !== String(userId)) return next(forbidden('You can only view your own dashboard'));

    const user = await User.findById(userId);
    if (!user) return next(notFound('User not found'));

    const dashboard = await getRenterDashboard(userId);
    res.json({ dashboard });
  } catch (e) { next(e); }
}

export async function ownerDashboard(req, res, next) {
  try {
    const { userId } = req.params;
    const uid = String(req.user.id);
    if (req.user.role !== 'admin' && uid !== String(userId)) return next(forbidden('You can only view your own dashboard'));

    const user = await User.findById(userId);
    if (!user) return next(notFound('User not found'));

    const dashboard = await getOwnerDashboard(userId);
    res.json({ dashboard });
  } catch (e) { next(e); }
}
