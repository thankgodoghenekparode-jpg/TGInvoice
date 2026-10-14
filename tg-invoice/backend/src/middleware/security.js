import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import config from '../config.js';

/** Secure HTTP headers (no extra config needed for a JSON API). */
export const securityHeaders = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/**
 * CORS locked to FRONTEND_URL — never origin: '*' in production.
 * The X-Tenant-Id header is explicitly allowed because it carries the
 * active-business context (membership is always re-verified server-side).
 */
export const corsOptions = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin / server-to-server
    const allowed = [config.frontendUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'];
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
  exposedHeaders: ['Content-Disposition'],
});

/** Aggressive limiter for authentication endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

/** Generous limiter for the rest of the API. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please slow down.' } },
});

/**
 * Per-TENANT limiter (mounted after requireTenant).
 *
 * The IP limit alone is not enough: one noisy business behind a shared office
 * NAT could exhaust the shared IP bucket and starve unrelated tenants. Keying
 * on tenant id budgets each business independently; unauthenticated traffic
 * falls back to the user id, then the IP.
 */
export const tenantLimiter = rateLimit({
  windowMs: config.rateLimit.tenantWindowMs,
  limit: config.rateLimit.perTenant,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.tenant?.id || req.user?.id || req.ip,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests for this business. Please slow down.' },
  },
});
