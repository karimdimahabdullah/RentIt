import { AppError } from '../utils/errors.js';

// Mount LAST: app.use(errorHandler)
export default function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError || err.status) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid id format', code: 'BAD_REQUEST' });
  if (err.code === 11000) return res.status(409).json({ error: 'Duplicate entry', code: 'CONFLICT' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
}
