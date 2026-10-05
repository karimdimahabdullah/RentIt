/**
 * Minimal auth stand-in so this module works standalone in Postman.
 * SWAP THIS for your project's real JWT middleware (Authentication & Authorization,
 * see the Backend API box in the system design) - it must set the same req.user
 * shape: { id, role }. Accepts either:
 *   Authorization: Bearer <jwt signed with JWT_SECRET, payload {id, role}>
 *   x-user-id / x-user-role headers (dev/testing convenience only, see settings.enableDevRoutes)
 */
import jwt from 'jsonwebtoken';
import { unauthorized } from '../utils/errors.js';
import { settings } from '../config/settings.js';

export function auth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'dev-secret-change-me');
      req.user = { id: payload.id, role: payload.role };
      return next();
    } catch (e) { return next(unauthorized('Invalid or expired token')); }
  }
  if (settings().enableDevRoutes && req.headers['x-user-id']) {
    req.user = { id: req.headers['x-user-id'], role: req.headers['x-user-role'] || 'renter' };
    return next();
  }
  return next(unauthorized());
}
