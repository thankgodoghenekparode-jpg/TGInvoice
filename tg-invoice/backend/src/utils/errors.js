/**
 * Central error model. Controllers throw AppError; the error middleware maps
 * it to a safe JSON response — no stack traces or Prisma internals leak out.
 */
export class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

export const errors = {
  badRequest: (msg = 'Invalid request.', details) => new AppError(msg, 400, 'BAD_REQUEST', details),
  unauthorized: (msg = 'Authentication required.') => new AppError(msg, 401, 'UNAUTHORIZED'),
  forbidden: (msg = 'You do not have permission to perform this action.') =>
    new AppError(msg, 403, 'FORBIDDEN'),
  notFound: (msg = 'Resource not found.') => new AppError(msg, 404, 'NOT_FOUND'),
  conflict: (msg = 'Resource already exists.', details) => new AppError(msg, 409, 'CONFLICT', details),
  tooMany: (msg = 'Too many requests. Please try again later.') => new AppError(msg, 429, 'TOO_MANY_REQUESTS'),
  internal: (msg = 'Something went wrong. Please try again.') => new AppError(msg, 500, 'INTERNAL'),
};

/** Wraps async route handlers so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default AppError;
