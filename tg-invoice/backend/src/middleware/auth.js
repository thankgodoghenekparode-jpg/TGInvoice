import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { verifyAccessToken, getRefreshCookie, rotateRefreshToken, setRefreshCookie } from '../services/tokenService.js';

/**
 * ── AUTH PIPELINE ─────────────────────────────────────────────────────
 * JWT (access token)
 *   ↓  requireAuth          → req.user
 *   ↓  requireTenant        → req.tenant / req.membership / req.role
 *                            (membership is VERIFIED server-side; the frontend
 *                             can never act as a tenant it does not belong to)
 *
 * Every tenant-scoped router mounts: requireAuth + requireTenant.
 * Controllers must query with { ..., tenantId: req.tenant.id } — never trust
 * tenantId from body/query for data access.
 */

/** Verifies the bearer access token and loads the user. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw errors.unauthorized('Authentication required.');

  const userId = verifyAccessToken(token);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      emailVerified: true,
      isPlatformAdmin: true,
      status: true,
      createdAt: true,
    },
  });
  if (!user) throw errors.unauthorized('Account no longer exists.');
  if (user.status !== 'ACTIVE') {
    throw errors.forbidden('Your account has been suspended. Please contact the platform administrator.');
  }

  req.user = user;
  next();
});

/**
 * Resolves the active tenant from the X-Tenant-Id header and verifies the
 * user actually holds an ACTIVE membership there. A forged header for
 * someone else's tenant yields 403 without touching tenant data.
 */
export const requireTenant = asyncHandler(async (req, _res, next) => {
  if (!req.user) throw errors.unauthorized('Authentication required.');

  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId || typeof tenantId !== 'string') {
    throw errors.badRequest('No active business selected. Please select a business.');
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: req.user.id, tenantId } },
    include: {
      tenant: { select: { id: true, name: true, slug: true, logo: true, status: true, createdAt: true } },
    },
  });

  // Same response shape for "no membership" and "tenant does not exist" —
  // never confirm the existence of another tenant's ID.
  if (!membership || membership.status !== 'ACTIVE') {
    throw errors.forbidden('You do not have access to this business.');
  }
  // Platform-suspended business: every member is blocked, not just outsiders.
  if (membership.tenant.status !== 'ACTIVE') {
    throw errors.forbidden('This business has been suspended by the platform administrator.');
  }

  // Tenant-level access expiry / auto-suspend enforcement (request-time)
  const now = new Date();
  const tenantExpires = membership.tenant.accessExpiresAt;
  if (tenantExpires && tenantExpires.getTime() < now.getTime()) {
    // Idempotent auto-suspend
    if (membership.tenant.status === 'ACTIVE') {
      await prisma.tenant.update({
        where: { id: membership.tenant.id },
        data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' },
      });
    }
    throw errors.forbidden('This business has been suspended by the platform administrator.');
  }

  // Membership-level access expiry / auto-suspend enforcement
  const memberExpires = membership.accessExpiresAt;
  if (memberExpires && memberExpires.getTime() < now.getTime()) {
    if (membership.status === 'ACTIVE') {
      await prisma.membership.update({
        where: { id: membership.id },
        data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' },
      });
    }
    throw errors.forbidden('You do not have access to this business.');
  }

  req.tenant = membership.tenant;
  req.membership = membership;
  req.role = membership.role;
  next();
});

/** Explicit tenant resolution for routes where the header is optional (e.g. switch list). */
export const optionalTenant = asyncHandler(async (req, _res, next) => {
  const tenantId = req.headers['x-tenant-id'];
  if (req.user && tenantId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
      include: { tenant: { select: { id: true, name: true, slug: true, logo: true, status: true } } },
    });
    if (membership && membership.status === 'ACTIVE' && membership.tenant.status === 'ACTIVE') {
      const now = new Date();
      const tenantExpires = membership.tenant.accessExpiresAt;
      if (tenantExpires && tenantExpires.getTime() < now.getTime()) {
        // Auto-suspend tenant if expired
        if (membership.tenant.status === 'ACTIVE') {
          await prisma.tenant.update({
            where: { id: membership.tenant.id },
            data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' },
          });
        }
        // Don't attach tenant context
        return next();
      }
      const memberExpires = membership.accessExpiresAt;
      if (memberExpires && memberExpires.getTime() < now.getTime()) {
        if (membership.status === 'ACTIVE') {
          await prisma.membership.update({
            where: { id: membership.id },
            data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' },
          });
        }
        return next();
      }
      req.tenant = membership.tenant;
      req.membership = membership;
      req.role = membership.role;
    }
  }
  next();
});

/* ── Role / permission enforcement (backend is the enforcer) ───────── */

export const ROLES = {
  OWNER: ['OWNER', 'ADMIN', 'STAFF'],
  ADMIN: ['ADMIN', 'STAFF'],
  STAFF: ['STAFF'],
};

/**
 * requireRole('OWNER') or requireRole('OWNER', 'ADMIN').
 * Rejects when the member's role is not in the allowed list.
 */
export const requireRole = (...allowed) => (req, _res, next) => {
  if (!req.role) return next(errors.forbidden('No business context.'));
  if (!allowed.includes(req.role)) {
    return next(errors.forbidden('Your role does not allow this action.'));
  }
  return next();
};

/** Owner-only actions: ownership transfer, tenant deletion, subscription, etc. */
export const requireOwner = requireRole('OWNER');

/** Owner or admin — team management, settings, audit logs. */
export const requireAdmin = requireRole('OWNER', 'ADMIN');

/**
 * Platform (super-admin) gate. Runs AFTER requireAuth and checks the
 * User.isPlatformAdmin flag, which NO tenant-facing flow can ever set —
 * it is granted only by the `npm run db:superadmin` bootstrap script or by
 * another existing platform administrator. Platform routes deliberately do
 * NOT run requireTenant: a platform operator oversees every business without
 * belonging to one.
 */
export const requirePlatformAdmin = (req, _res, next) => {
  if (!req.user?.isPlatformAdmin) {
    return next(errors.forbidden('Platform administration access required.'));
  }
  return next();
};
