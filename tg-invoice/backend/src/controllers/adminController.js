import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { revokeAllRefreshTokens } from '../services/tokenService.js';
import { notifyUser, notifyTenantAdmins } from '../services/notificationService.js';
import { slugify as baseSlugify } from './authController.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

/**
 * ── PLATFORM ADMINISTRATION ──────────────────────────────────────────
 * Oversight AND management of the whole platform, behind
 * requireAuth + requirePlatformAdmin. Deliberately NOT tenant-scoped: a
 * platform operator oversees every business without belonging to one.
 *
 * Reads expose aggregate counts/sums and directory rows (tenant + member
 * identity) — never invoice/customer contents. Writes are limited to
 * platform-level controls: register a business, edit its contact details,
 * suspend/activate a business, grant/revoke access to a business, and
 * suspend/activate accounts or grant platform-admin access.
 *
 * Every action is written to the affected tenant's audit trail.
 */

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const num = (value) => Number(value || 0);

/** Parse page/limit/q safely from the query string. */
function listParams(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  let limit = parseInt(query.limit, 10) || 20;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;
  const q = String(query.q || '').trim().slice(0, 120);
  return { page, limit, q };
}

const pageMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasNext: page * limit < total,
  hasPrev: page > 1,
});

const SEQ_KINDS = ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT'];
const seqPrefix = (kind) => (kind === 'QUOTATION' ? 'QT' : kind === 'RECEIPT' ? 'REC' : kind === 'CUSTOMER' ? 'CUS' : 'INV');

/**
 * Audit a platform action against a representative tenant when the target
 * is a user (AuditLog is tenant-scoped). Silently skips users with no
 * membership — platform admins have none.
 */
async function auditUserAction(req, targetUserId, action, description) {
  const membership = await prisma.membership.findFirst({
    where: { userId: targetUserId, status: 'ACTIVE' },
    select: { tenantId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (membership) {
    await logAudit({ tenantId: membership.tenantId, userId: req.user.id }, action, 'user', {
      entityId: targetUserId,
      description,
    });
  }
}

/* ── GET /api/admin/overview ──────────────────────────────────────── */

export const overview = asyncHandler(async (_req, res) => {
  const [
    tenants,
    users,
    memberships,
    customers,
    products,
    quotations,
    invoices,
    receipts,
    payments,
    suspendedTenants,
    suspendedUsers,
    platformAdmins,
    tenantAdmins,
    invoicedAgg,
    collectedAgg,
    outstandingAgg,
    statusGroups,
    recentTenants,
    tenants30d,
    users30d,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.membership.count(),
    prisma.customer.count(),
    prisma.product.count(),
    prisma.quotation.count(),
    prisma.invoice.count(),
    prisma.receipt.count(),
    prisma.payment.count(),
    prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    // Platform operators vs the tenant admins (business owners/admins) — the
    // only two account populations a platform owner actually deals with.
    prisma.user.count({ where: { isPlatformAdmin: true } }),
    prisma.user.count({ where: { memberships: { some: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' } } } }),
    // VOID/CANCELLED documents are excluded from platform revenue figures.
    prisma.invoice.aggregate({
      _sum: { total: true },
      where: { status: { notIn: ['VOID', 'CANCELLED'] } },
    }),
    prisma.payment.aggregate({ _sum: { amount: true } }),
    prisma.invoice.aggregate({
      _sum: { balanceDue: true },
      where: { status: { notIn: ['VOID', 'CANCELLED'] } },
    }),
    prisma.invoice.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: {
        _count: { select: { invoices: true, customers: true } },
        memberships: {
          where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { name: true, email: true } } },
        },
      },
    }),
    prisma.tenant.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
  ]);

  return ok(res, {
    counts: {
      tenants, users, memberships, customers, products, quotations, invoices, receipts, payments,
      suspendedTenants, suspendedUsers, platformAdmins, tenantAdmins,
    },
    money: {
      invoiced: num(invoicedAgg._sum.total),
      collected: num(collectedAgg._sum.amount),
      outstanding: num(outstandingAgg._sum.balanceDue),
    },
    invoicesByStatus: Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])),
    growth: { tenants30d, users30d },
    recentTenants: recentTenants.map((t) => {
      const owner = t.memberships.find((m) => m.role === 'OWNER') || t.memberships[0] || null;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        createdAt: t.createdAt,
        owner: owner ? { name: owner.user.name, email: owner.user.email } : null,
        admins: t.memberships.length,
        invoices: t._count.invoices,
        customers: t._count.customers,
      };
    }),
  });
});

/* ── GET /api/admin/tenants ───────────────────────────────────────── */

export const listTenants = asyncHandler(async (req, res) => {
  const { page, limit, q } = listParams(req.query);
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: {
          select: { memberships: true, customers: true, invoices: true, quotations: true, receipts: true, payments: true },
        },
        memberships: {
          where: { role: { in: ['OWNER', 'ADMIN'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, status: true, accessExpiresAt: true, suspendedAt: true, suspensionReason: true, userId: true, user: { select: { id: true, name: true, email: true, status: true } } },
        },
        companySettings: { select: { currency: true, currencySymbol: true } },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  const ids = rows.map((t) => t.id);
  const [invAgg, payAgg] = ids.length
    ? await Promise.all([
        prisma.invoice.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _sum: { total: true, balanceDue: true } }),
        prisma.payment.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _sum: { amount: true } }),
      ])
    : [[], []];

  const invMap = new Map(invAgg.map((r) => [r.tenantId, r._sum]));
  const payMap = new Map(payAgg.map((r) => [r.tenantId, r._sum]));

  const items = rows.map((t) => {
    const owner = t.memberships.find((m) => m.role === 'OWNER') || t.memberships[0] || null;
    const inv = invMap.get(t.id) || {};
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      logo: t.logo,
      status: t.status,
      createdAt: t.createdAt,
      currency: t.companySettings?.currencySymbol || t.companySettings?.currency || '₦',
      counts: t._count,
      adminsCount: t.memberships.length,
      owner: owner ? { name: owner.user.name, email: owner.user.email } : null,
      members: t.memberships.map((m) => ({ id: m.id, role: m.role, status: m.status, user: m.user })),
      invoiced: num(inv.total),
      collected: num(payMap.get(t.id)?.amount),
      outstanding: num(inv.balanceDue),
    };
  });

  return ok(res, items, pageMeta(total, page, limit));
});

/* ── GET /api/admin/tenants/:id ───────────────────────────────────── */

export const getTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      _count: {
        select: { memberships: true, customers: true, invoices: true, quotations: true, receipts: true, payments: true },
      },
      memberships: {
        where: { role: { in: ['OWNER', 'ADMIN'] } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, role: true, status: true, accessExpiresAt: true, suspendedAt: true, suspensionReason: true, userId: true, user: { select: { id: true, name: true, email: true, status: true } } },
      },
      companySettings: {
        select: { businessName: true, phone: true, email: true, country: true, currency: true, currencySymbol: true },
      },
    },
  });
  if (!tenant) throw errors.notFound('Business not found.');

  ok(res, {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logo: tenant.logo,
    status: tenant.status,
    createdAt: tenant.createdAt,
    currency: tenant.companySettings?.currencySymbol || tenant.companySettings?.currency || '₦',
    contact: {
      phone: tenant.companySettings?.phone || null,
      email: tenant.companySettings?.email || null,
      country: tenant.companySettings?.country || null,
    },
    counts: tenant._count,
    adminsCount: tenant.memberships.length,
    members: tenant.memberships.map((m) => ({ id: m.id, role: m.role, status: m.status, user: m.user })),
  });
});

/* ── POST /api/admin/tenants — register a new business ────────────── */

export const createTenant = asyncHandler(async (req, res) => {
  const body = req.validatedBody;
  const currency = body.currency || { code: 'NGN', symbol: '₦', position: 'prefix' };

  // Optionally attach an existing account as the first owner.
  let owner = null;
  if (body.ownerEmail) {
    owner = await prisma.user.findUnique({
      where: { email: body.ownerEmail.toLowerCase() },
      select: { id: true, name: true, email: true, status: true },
    });
    if (!owner) {
      throw errors.badRequest('No account exists for that owner email. Ask them to sign up first, or leave the owner blank.', [
        { path: 'ownerEmail', message: 'No account with that email.' },
      ]);
    }
    if (owner.status !== 'ACTIVE') {
      throw errors.badRequest('That owner account is suspended. Reactivate it before assigning the business.', [
        { path: 'ownerEmail', message: 'That account is suspended.' },
      ]);
    }
  }

  const tenant = await prisma.$transaction(async (tx) => {
    const slugBase = baseSlugify(body.name);
    let slug = slugBase;
    let made = null;
    for (let n = 1; n < 50 && !made; n += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        made = await tx.tenant.create({ data: { name: body.name, slug, status: 'ACTIVE' } });
      } catch (err) {
        if (err?.code !== 'P2002') throw err; // concurrent slug collision → retry
        slug = `${slugBase}-${n + 1}`;
      }
    }
    if (!made) throw errors.conflict('Could not allocate a unique business address. Please use a different name.');

    if (owner) {
      await tx.membership.create({ data: { userId: owner.id, tenantId: made.id, role: 'OWNER', status: 'ACTIVE' } });
    }

    await tx.companySettings.create({
      data: {
        tenantId: made.id,
        businessName: body.name,
        phone: body.phone || null,
        email: body.email || null,
        country: body.country || 'Nigeria',
        currency: currency.code,
        currencySymbol: currency.symbol,
        currencyPosition: currency.position,
        defaultCurrency: currency.code,
        onboardingComplete: false,
      },
    });

    for (const kind of SEQ_KINDS) {
      await tx.documentSequence.create({ data: { tenantId: made.id, kind, prefix: seqPrefix(kind), next: 1 } });
    }

    return made;
  });

  await logAudit({ tenantId: tenant.id, userId: req.user.id }, 'CREATE_TENANT', 'tenant', {
    entityId: tenant.id,
    entityLabel: tenant.name,
    description: `Platform admin ${req.user.name} registered business ${tenant.name}`,
  });

  created(res, {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    owner: owner ? { name: owner.name, email: owner.email } : null,
  });
});

/* ── PATCH /api/admin/tenants/:id — contact / name ────────────────── */

export const updateTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = req.validatedBody;

  const existing = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw errors.notFound('Business not found.');

  const tenantData = {};
  if (body.name !== undefined) tenantData.name = body.name;

  const tenant = Object.keys(tenantData).length
    ? await prisma.tenant.update({ where: { id }, data: tenantData })
    : await prisma.tenant.findUnique({ where: { id } });

  const settingsData = {};
  if (body.name !== undefined) settingsData.businessName = body.name;
  if (body.phone !== undefined) settingsData.phone = body.phone || null;
  if (body.email !== undefined) settingsData.email = body.email || null;
  if (body.country !== undefined) settingsData.country = body.country || null;
  if (Object.keys(settingsData).length) {
    await prisma.companySettings.updateMany({ where: { tenantId: id }, data: settingsData });
  }

  const expiry = body.accessExpiresAt;
  if (expiry !== undefined) {
    tenantData.accessExpiresAt = expiry;
    if (expiry && new Date(expiry).getTime() < Date.now()) {
      tenantData.status = 'SUSPENDED';
      tenantData.suspendedAt = new Date();
      tenantData.suspensionReason = 'Access period expired (auto)';
    } else if (!expiry) {
      tenantData.status = 'ACTIVE';
      tenantData.suspendedAt = null;
      tenantData.suspensionReason = null;
    }
  }

  await logAudit({ tenantId: id, userId: req.user.id }, 'UPDATE_TENANT', 'tenant', {
    entityId: id,
    entityLabel: tenant.name,
    description: `Platform admin ${req.user.name} updated business details`,
  });

  ok(res, { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, accessExpiresAt: tenant.accessExpiresAt, suspendedAt: tenant.suspendedAt });
});

/* ── Suspend / activate a business ────────────────────────────────── */

async function setTenantStatus(req, res, status) {
  const { id } = req.params;
  const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
  if (!tenant) throw errors.notFound('Business not found.');

  const now = new Date();
  const updateData = status === 'ACTIVE'
    ? { status, suspendedAt: null, accessExpiresAt: null }
    : { status, suspendedAt: now };
  const updated = await prisma.tenant.update({ where: { id }, data: updateData });

  await logAudit({ tenantId: id, userId: req.user.id }, status === 'SUSPENDED' ? 'SUSPEND_TENANT' : 'ACTIVATE_TENANT', 'tenant', {
    entityId: id,
    entityLabel: tenant.name,
    description: `Platform admin ${req.user.name} ${status === 'SUSPENDED' ? 'suspended' : 'reactivated'} business ${tenant.name}`,
  });

  const suspended = status === 'SUSPENDED';
  await notifyTenantAdmins({
    tenantId: id,
    type: suspended ? 'TENANT_SUSPENDED' : 'TENANT_ACTIVATED',
    title: suspended ? `${tenant.name} has been suspended` : `${tenant.name} has been reactivated`,
    body: suspended
      ? 'Your business was suspended by a platform administrator. Members cannot sign in until it is reactivated.'
      : 'Your business has been reactivated. Everyone can sign in again.',
    link: '/dashboard',
    email: {
      subject: suspended ? `${tenant.name} has been suspended` : `${tenant.name} has been reactivated`,
      text: suspended
        ? 'Your business was suspended by a platform administrator. Contact support for details.'
        : 'Your business has been reactivated on TG Invoice.',
    },
  });

  ok(res, { id: updated.id, name: updated.name, slug: updated.slug, status: updated.status, suspendedAt: updated.suspendedAt, accessExpiresAt: updated.accessExpiresAt });
}

export const suspendTenant = asyncHandler((req, res) => setTenantStatus(req, res, 'SUSPENDED'));
export const activateTenant = asyncHandler((req, res) => setTenantStatus(req, res, 'ACTIVE'));

/* ── POST /api/admin/tenants/:id/members — grant access ───────────── */

export const grantMember = asyncHandler(async (req, res) => {
  const { id: tenantId } = req.params;
  const { role, userId, email } = req.validatedBody;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) throw errors.notFound('Business not found.');

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, status: true } })
    : await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, name: true, email: true, status: true } });

  if (!user) {
    throw errors.badRequest('No account found for that user. They must sign up before access can be granted.', [
      { path: 'email', message: 'No account with that email.' },
    ]);
  }
  if (user.status !== 'ACTIVE') {
    throw errors.badRequest('That account is suspended. Reactivate it before granting access.', [
      { path: 'email', message: 'That account is suspended.' },
    ]);
  }

  const membership = await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    create: { userId: user.id, tenantId, role, status: 'ACTIVE', accessExpiresAt: req.validatedBody?.accessExpiresAt || null },
    update: { role, status: 'ACTIVE', suspendedAt: null, accessExpiresAt: req.validatedBody?.accessExpiresAt !== undefined ? req.validatedBody.accessExpiresAt : undefined },
  });

  await logAudit({ tenantId, userId: req.user.id }, 'GRANT_ACCESS', 'membership', {
    entityId: membership.id,
    entityLabel: user.email,
    description: `Platform admin ${req.user.name} granted ${user.email} ${role} access to ${tenant.name}`,
  });

  await notifyUser(user.id, {
    tenantId,
    type: 'ACCESS_GRANTED',
    title: `You now have access to ${tenant.name}`,
    body: `You were granted ${role === 'OWNER' ? 'owner' : 'admin'} access. Switch to this business from the business menu.`,
    link: '/dashboard',
    email: {
      subject: `Access granted to ${tenant.name}`,
      text: `A platform administrator granted you ${role} access to ${tenant.name} on TG Invoice.`,
    },
  });

  ok(res, {
    membership: { id: membership.id, role: membership.role, status: membership.status, accessExpiresAt: membership.accessExpiresAt, suspendedAt: membership.suspendedAt },
    user: { id: user.id, name: user.name, email: user.email, status: user.status },
  });
});

/* ── DELETE /api/admin/tenants/:id/members/:userId — revoke ───────── */

export const revokeMember = asyncHandler(async (req, res) => {
  const { id: tenantId, userId } = req.params;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) throw errors.notFound('Business not found.');

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!membership) throw errors.notFound('That account is not a member of this business.');

  // Never orphan a business: keep at least one active owner.
  if (membership.role === 'OWNER') {
    const owners = await prisma.membership.count({ where: { tenantId, role: 'OWNER', status: 'ACTIVE' } });
    if (owners <= 1) {
      throw errors.badRequest('This is the business\u2019s only owner. Grant another owner before removing this one.');
    }
  }

  await prisma.membership.delete({ where: { id: membership.id } });

  await logAudit({ tenantId, userId: req.user.id }, 'REVOKE_ACCESS', 'membership', {
    entityId: membership.id,
    entityLabel: membership.user.email,
    description: `Platform admin ${req.user.name} revoked access for ${membership.user.email} from ${tenant.name}`,
  });

  await notifyUser(userId, {
    tenantId,
    type: 'ACCESS_REVOKED',
    title: `Your access to ${tenant.name} was removed`,
    body: 'A platform administrator removed your access to this business.',
    link: '/dashboard',
    email: {
      subject: `Access removed — ${tenant.name}`,
      text: `Your access to ${tenant.name} on TG Invoice has been removed.`,
    },
  });

  ok(res, { id: membership.id, revoked: true });
});

export const setMemberExpiry = asyncHandler(async (req, res) => {
  const { id: tenantId, userId } = req.params;
  const { accessExpiresAt } = req.body || {};
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) throw errors.notFound('Business not found.');
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!membership) throw errors.notFound('That account is not a member of this business.');

  const now = new Date();
  const expiry = accessExpiresAt ? new Date(accessExpiresAt) : null;
  const update = { accessExpiresAt: expiry };
  if (expiry && expiry.getTime() < now.getTime()) {
    update.status = 'SUSPENDED';
    update.suspendedAt = now;
  } else if (!expiry) {
    update.status = 'ACTIVE';
    update.suspendedAt = null;
  }
  const updated = await prisma.membership.update({ where: { id: membership.id }, data: update });

  await logAudit({ tenantId, userId: req.user.id }, 'UPDATE_MEMBER_EXPIRY', 'membership', {
    entityId: updated.id,
    entityLabel: membership.user.email,
    description: `Platform admin ${req.user.name} set access expiry for ${membership.user.email} to ${expiry ? expiry.toISOString() : 'never'}`,
  });

  ok(res, { id: updated.id, accessExpiresAt: updated.accessExpiresAt, status: updated.status, suspendedAt: updated.suspendedAt });
});

/* ── GET /api/admin/users — platform operators only ───────────────── */
/*
 * The Users area lists PLATFORM users: accounts that operate the platform
 * (User.isPlatformAdmin). Tenant staff/end-users are the tenant admin's
 * responsibility and never appear here. The people a platform owner deals
 * with inside a business — its tenant admins — are managed on the business
 * itself (see the Businesses view / grantMember).
 */

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, q } = listParams(req.query);
  const where = {
    isPlatformAdmin: true,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        emailVerified: true,
        isPlatformAdmin: true,
        status: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            status: true,
            accessExpiresAt: true,
            suspendedAt: true,
            tenant: { select: { id: true, name: true, slug: true, status: true } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return ok(res, rows, pageMeta(total, page, limit));
});

/* ── POST /api/admin/users — add a platform operator ──────────────── */
/*
 * Promote an existing account to platform admin, or create a brand-new
 * operator account. Creating returns a temporary password ONCE (never
 * emailed) for the super-admin to hand over securely.
 */

function generateTemporaryPassword() {
  // 9 random bytes → 12 URL-safe characters (~72 bits of entropy).
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

export const addPlatformUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.validatedBody;
  const normalized = email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, name: true, email: true, status: true, isPlatformAdmin: true },
  });

  // Promote an existing account — it keeps its password and memberships.
  if (existing) {
    if (existing.isPlatformAdmin) {
      throw errors.conflict('That account is already a platform admin.', [
        { path: 'email', message: 'Already a platform admin.' },
      ]);
    }
    const promoted = await prisma.user.update({
      where: { id: existing.id },
      data: { isPlatformAdmin: true, status: 'ACTIVE', emailVerified: true },
      select: { id: true, name: true, email: true, status: true, isPlatformAdmin: true },
    });

    await notifyUser(promoted.id, {
      type: 'PLATFORM_ADMIN_GRANTED',
      title: 'Platform-admin access granted',
      body: 'You now have access to the platform administration area.',
      link: '/admin',
      email: {
        subject: 'You are now a TG Invoice platform admin',
        text: 'Platform-administrator access has been granted to your account.',
      },
    });

    return ok(res, {
      user: { ...promoted, isPlatformAdmin: true },
      created: false,
      promoted: true,
      temporaryPassword: null,
    });
  }

  // Create a new operator account.
  const provided = typeof password === 'string' ? password.trim() : '';
  const temporaryPassword = provided.length >= 8 ? provided : generateTemporaryPassword();
  const displayName = (name && name.trim()) || normalized.split('@')[0];

  const account = await prisma.user.create({
    data: {
      name: displayName,
      email: normalized,
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      emailVerified: true,
      isPlatformAdmin: true,
      status: 'ACTIVE',
    },
    select: { id: true, name: true, email: true, status: true, isPlatformAdmin: true },
  });

  await notifyUser(account.id, {
    type: 'PLATFORM_ADMIN_GRANTED',
    title: 'Your platform account is ready',
    body: 'You have been added as a TG Invoice platform administrator.',
    link: '/admin',
    email: {
      subject: 'Welcome to TG Invoice (platform admin)',
      text: 'A platform-administrator account has been created for you. Sign in with the credentials your administrator shared.',
    },
  });

  created(res, {
    user: { ...account, isPlatformAdmin: true },
    created: true,
    promoted: false,
    temporaryPassword: provided.length >= 8 ? null : temporaryPassword,
  });
});

/* ── Suspend / activate an account ────────────────────────────────── */

async function setUserStatus(req, res, status) {
  const { id } = req.params;
  if (id === req.user.id) throw errors.badRequest('You cannot suspend your own account.');
  if (req.user.status !== 'ACTIVE') throw errors.forbidden('Your account is suspended.');

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
  if (!user) throw errors.notFound('Account not found.');

  const updateData = status === 'ACTIVE' ? { status, suspendedAt: null } : { status, suspendedAt: new Date() };
  const updated = await prisma.user.update({ where: { id }, data: updateData });
  if (status === 'SUSPENDED') await revokeAllRefreshTokens(id);

  await auditUserAction(
    req,
    id,
    status === 'SUSPENDED' ? 'SUSPEND_USER' : 'ACTIVATE_USER',
    `Platform admin ${req.user.name} ${status === 'SUSPENDED' ? 'suspended' : 'reactivated'} ${user.email}`
  );

  const suspended = status === 'SUSPENDED';
  await notifyUser(id, {
    type: suspended ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_ACTIVATED',
    title: suspended ? 'Your account has been suspended' : 'Your account has been reactivated',
    body: suspended
      ? 'A platform administrator suspended your account. Contact support if you believe this is a mistake.'
      : 'Your account is active again. You can sign in normally.',
    email: {
      subject: suspended ? 'Your TG Invoice account has been suspended' : 'Your TG Invoice account has been reactivated',
      text: suspended
        ? 'Your TG Invoice account was suspended by a platform administrator.'
        : 'Your TG Invoice account is active again.',
    },
  });

  ok(res, { id: updated.id, name: updated.name, email: updated.email, status: updated.status, suspendedAt: updated.suspendedAt });
}

export const suspendUser = asyncHandler((req, res) => setUserStatus(req, res, 'SUSPENDED'));
export const activateUser = asyncHandler((req, res) => setUserStatus(req, res, 'ACTIVE'));

/* ── PATCH /api/admin/users/:id/platform-admin ────────────────────── */

export const setPlatformAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isPlatformAdmin } = req.validatedBody;

  if (id === req.user.id) throw errors.badRequest('You cannot change your own platform-admin access.');

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, status: true },
  });
  if (!user) throw errors.notFound('Account not found.');
  if (isPlatformAdmin && user.status !== 'ACTIVE') {
    throw errors.badRequest('A suspended account cannot be made a platform admin. Reactivate it first.');
  }

  const updated = await prisma.user.update({ where: { id }, data: { isPlatformAdmin } });

  await auditUserAction(
    req,
    id,
    isPlatformAdmin ? 'GRANT_PLATFORM_ADMIN' : 'REVOKE_PLATFORM_ADMIN',
    `Platform admin ${req.user.name} ${isPlatformAdmin ? 'granted' : 'revoked'} platform-admin access for ${user.email}`
  );

  await notifyUser(id, {
    type: isPlatformAdmin ? 'PLATFORM_ADMIN_GRANTED' : 'PLATFORM_ADMIN_REVOKED',
    title: isPlatformAdmin ? 'Platform-admin access granted' : 'Platform-admin access revoked',
    body: isPlatformAdmin
      ? 'You can now access the platform administration area.'
      : 'Your platform administrator access was removed.',
    link: isPlatformAdmin ? '/admin' : '/dashboard',
    email: {
      subject: isPlatformAdmin ? 'You are now a TG Invoice platform admin' : 'Platform-admin access removed',
      text: isPlatformAdmin
        ? 'Platform-administrator access has been granted to your account.'
        : 'Your platform-administrator access has been removed.',
    },
  });

  ok(res, { id: updated.id, name: updated.name, email: updated.email, isPlatformAdmin: updated.isPlatformAdmin });
});

export default {
  overview,
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  suspendTenant,
  activateTenant,
  grantMember,
  revokeMember,
  listUsers,
  addPlatformUser,
  suspendUser,
  activateUser,
  setPlatformAdmin,
  setMemberExpiry,
};
