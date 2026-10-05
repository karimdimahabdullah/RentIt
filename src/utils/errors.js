export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const notFound   = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const forbidden  = (msg = 'You are not allowed to perform this action') => new AppError(403, 'FORBIDDEN', msg);
export const badRequest = (msg) => new AppError(400, 'BAD_REQUEST', msg);
export const conflict   = (msg) => new AppError(409, 'CONFLICT', msg);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
