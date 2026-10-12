import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { getRefreshCookie } from '../services/tokenService.js';
import crypto from 'node:crypto';
import { slugify as baseSlugify } from './authController.js';

/** Create a business for the current user (multi-business support). */
async function createBusinessFor(userId, data) {
  return prisma.$transaction(async (tx) => {
    let slugBase = baseSlugify(data.name);
    let slug = slugBase;
    let n = 1;
    let tenant = null;

    while (!tenant && n < 50) {
      try {
        tenant = await tx.tenant.create({ data: { name: data.name, slug } });
      } catch (err) {
        if (err?.code !== 'P2002') throw err;
        n += 1;
        slug = `${slugBase}-${n}`;
      }
    }
    if (!tenant) throw errors.conflict('Could not allocate a unique business address.');

    await tx.membership.create({ data: { userId, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });

    const currency = data.currency || { code: 'NGN', symbol: '₦', position: 'prefix' };
    await tx.companySettings.create({
      data: {
        tenantId: tenant.id,
        businessName: data.name,
        phone: data.phone || null,
        email: data.email || null,
        country: data.country || 'Nigeria',
        currency: currency.code,
        currencySymbol: currency.symbol,
        currencyPosition: currency.position,
        defaultCurrency: currency.code,
        onboardingComplete: false,
      },
    });

    for (const kind of ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT']) {
      await tx.documentSequence.create({
        data: { tenantId: tenant.id, kind, prefix: kind === 'QUOTATION' ? 'QT' : kind === 'RECEIPT' ? 'REC' : kind === 'CUSTOMER' ? 'CUS' : 'INV', next: 1 },
      });
    }

    return tenant;
  });
}

/* ── GET /api/tenants — businesses the current user belongs to ────── */

export const listTenants = asyncHandler(async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.user.id, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
    include: { tenant: { select: { id: true, name: true, slug: true, logo: true, createdAt: true, accessExpiresAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const now = new Date();
  const expiredTenantIds = memberships
    .filter((m) => {
      const texp = m.tenant.accessExpiresAt;
      return texp && texp.getTime() < now.getTime();
    })
    .map((m) => m.tenant.id);
  const expiredMembershipIds = memberships
    .filter((m) => {
      const mexp = m.accessExpiresAt;
      return mexp && mexp.getTime() < now.getTime();
    })
    .map((m) => m.id);
  if (expiredTenantIds.length > 0) {
    await prisma.tenant.updateMany({ where: { id: { in: expiredTenantIds }, status: 'ACTIVE' }, data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' } });
  }
  if (expiredMembershipIds.length > 0) {
    await prisma.membership.updateMany({ where: { id: { in: expiredMembershipIds }, status: 'ACTIVE' }, data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' } });
  }
  // Filter out any that became suspended
  const filtered = memberships.filter((m) => {
    const texp = m.tenant.accessExpiresAt;
    if (texp && texp.getTime() < now.getTime()) return false;
    const mexp = m.accessExpiresAt;
    if (mexp && mexp.getTime() < now.getTime()) return false;
    return true;
  });
  ok(res, filtered.map((m) => ({ ...m.tenant, role: m.role })));
});

/* ── POST /api/tenants — create another business ──────────────────── */

export const createTenant = asyncHandler(async (req, res) => {
  const { name, phone, email, country, currency } = req.body;
  if (!name || String(name).trim().length < 2) {
    throw errors.badRequest('Business name is required.', [{ path: 'name', message: 'Business name must be at least 2 characters.' }]);
  }

  const tenant = await createBusinessFor(req.user.id, {
    name: String(name).trim(),
    phone,
    email,
    country,
    currency,
  });

  await logAudit({ tenantId: tenant.id, userId: req.user.id }, 'CREATE_TENANT', 'tenant', {
    entityLabel: tenant.name,
    description: `${req.user.name} created business ${tenant.name}`,
  });

  created(res, { id: tenant.id, name: tenant.name, slug: tenant.slug, role: 'OWNER' });
});

/* ── GET /api/tenants/:id — member view only ──────────────────────── */

export const getTenant = asyncHandler(async (req, res) => {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: req.user.id, tenantId: req.params.id } },
    include: { tenant: true },
  });
  if (!membership || membership.status !== 'ACTIVE' || membership.tenant.status !== 'ACTIVE') {
    throw errors.notFound('Business not found.');
  }
  const now = new Date();
  const texp = membership.tenant.accessExpiresAt;
  if (texp && texp.getTime() < now.getTime()) {
    if (membership.tenant.status === 'ACTIVE') {
      await prisma.tenant.update({ where: { id: membership.tenant.id }, data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' } });
    }
    throw errors.notFound('Business not found.');
  }
  const mexp = membership.accessExpiresAt;
  if (mexp && mexp.getTime() < now.getTime()) {
    if (membership.status === 'ACTIVE') {
      await prisma.membership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' } });
    }
    throw errors.notFound('Business not found.');
  }
  ok(res, { ...membership.tenant, role: membership.role });
});

/* ── PUT /api/tenants/:id — OWNER/ADMIN rename etc. ───────────────── */

export const updateTenant = asyncHandler(async (req, res) => {
  // Role check happens against THIS tenant's membership, not the header context.
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: req.user.id, tenantId: req.params.id } },
    include: { tenant: { select: { id: true, status: true } } },
  });
  if (!membership || membership.status !== 'ACTIVE') throw errors.notFound('Business not found.');
  if (membership.tenant?.status !== 'ACTIVE') throw errors.forbidden('This business has been suspended by the platform administrator.');
  if (!['OWNER', 'ADMIN'].includes(membership.role)) throw errors.forbidden('Only owners and admins can update business details.');

  const { name } = req.body;
  if (!name || String(name).trim().length < 2) throw errors.badRequest('Business name is required.');

  const tenant = await prisma.tenant.update({
    where: { id: req.params.id },
    data: { name: String(name).trim() },
  });
  await prisma.companySettings.updateMany({ where: { tenantId: tenant.id }, data: { businessName: tenant.name } });

  await logAudit({ tenantId: tenant.id, userId: req.user.id }, 'UPDATE_TENANT', 'tenant', {
    entityLabel: tenant.name,
    description: `${req.user.name} updated business details`,
  });

  ok(res, { id: tenant.id, name: tenant.name, slug: tenant.slug });
});

/* ── POST /api/tenants/switch — membership is re-verified ─────────── */

export const switchTenant = asyncHandler(async (req, res) => {
  const { tenantId } = req.body || {};
  if (!tenantId) throw errors.badRequest('Select a business to switch to.');

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: req.user.id, tenantId } },
    include: { tenant: { select: { id: true, name: true, slug: true, logo: true, status: true } } },
  });

  // A tenant the user does not belong to is indistinguishable from a
  // non-existent one: 403, no data, no confirmation the ID exists.
  if (!membership || membership.status !== 'ACTIVE') {
    throw errors.forbidden('You do not have access to this business.');
  }
  if (membership.tenant.status !== 'ACTIVE') {
    throw errors.forbidden('This business has been suspended by the platform administrator.');
  }
  const now = new Date();
  const texp = membership.tenant.accessExpiresAt;
  if (texp && texp.getTime() < now.getTime()) {
    if (membership.tenant.status === 'ACTIVE') {
      await prisma.tenant.update({ where: { id: membership.tenant.id }, data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' } });
    }
    throw errors.forbidden('This business has been suspended by the platform administrator.');
  }
  const mexp = membership.accessExpiresAt;
  if (mexp && mexp.getTime() < now.getTime()) {
    if (membership.status === 'ACTIVE') {
      await prisma.membership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: 'Access period expired (auto)' } });
    }
    throw errors.forbidden('You do not have access to this business.');
  }

  // Remember the choice on the session (refresh-token row).
  const cookie = getRefreshCookie(req);
  if (cookie) {
    const tokenHash = crypto.createHash('sha256').update(cookie).digest('hex');
    await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { tenantId } });
  }

  await logAudit({ tenantId, userId: req.user.id }, 'SWITCH_TENANT', 'tenant', {
    entityLabel: membership.tenant.name,
    description: `${req.user.name} switched to ${membership.tenant.name}`,
  });

  ok(res, { tenant: membership.tenant, role: membership.role });
});

export { createBusinessFor };
