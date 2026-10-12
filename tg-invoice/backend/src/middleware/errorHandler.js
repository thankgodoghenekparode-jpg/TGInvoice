import { ZodError } from 'zod';
import { AppError, errors } from '../utils/errors.js';
import config from '../config.js';

/** Validate req[source] with a Zod schema; 400 with field details on failure. */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      // For query: keep raw strings for pagination but store parsed values.
      req[source === 'query' ? 'validatedQuery' : 'validatedBody'] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        return next(errors.badRequest('Please check the highlighted fields.', details));
      }
      return next(err);
    }
  };

/**
 * Central error handler. Known AppErrors pass through with their message;
 * everything else becomes a generic 500 — Prisma errors, stack traces and
 * database internals are logged server-side only.
 */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }

  // Multer upload failures → friendly 400s.
  if (err?.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be smaller than 2 MB.' : 'Upload failed. Please try again.';
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message } });
  }

  // Prisma known request errors → friendly messages (no driver details out).
  if (err?.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'That value already exists. Please use a different one.' },
    });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Resource not found.' },
    });
  }
  if (err?.code === 'P2003') {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'This record is referenced by other data and cannot be changed.' },
    });
  }

  console.error('[api-error]', err);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL',
      message: config.isProd
        ? 'Something went wrong. Please try again.'
        : err?.message || 'Something went wrong. Please try again.',
    },
  });
}

/** 404 for unknown API routes. */
export function notFoundHandler(_req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
}
