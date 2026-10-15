import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';
import config from '../config.js';
import { notifyTenantAdmins } from './notificationService.js';

/**
 * Referrals & the affiliate/reseller program.
 *
 * Three tables, no money movement — this is the *program mechanics*:
 *   - ReferralCode  a shareable code owned by a business, a partner or the platform;
 *   - Referral      one business attributed to a code (PENDING → ACTIVE → REWARDED);
 *   - Partner       a reseller / accountant / affiliate that owns codes.
 *
 * Attribution happens at signup. A referral becomes ACTIVE once the referred
 * business issues its first invoice (a real "they're actually using it" signal,
 * applied by the `referral.qualify` job). Rewards are credited by a platform
 * admin, because setting a monetary value is a business decision.
 */

export const OWNER_TYPES = ['PLATFORM', 'TENANT', 'USER', 'PARTNER'];
export const REWARD_TYPES = ['PERCENT', 'FIXED'];
export const PARTNER_TYPES = ['RESELLER', 'ACCOUNTANT', 'AFFILIATE'];

/** Invoices the referred business must issue before the referral qualifies. */
export const QUALIFY_INVOICES = 1;

export const MAX_CODE_LENGTH = 16;

/** Unambiguous alphabet — no O/0, I/1 confusion when people type a code. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ── Codes ────────────────────────────────────────────────────────── */

export function normalizeCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_CODE_LENGTH);
}

export function randomCode(prefix = 'TG') {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `${prefix}${out}`;
}

async function uniqueCode(db, prefix = 'TG') {
  for (let i = 0; i < 8; i += 1) {
    const candidate = randomCode(prefix);
    const clash = await db.referralCode.findUnique({ where: { code: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw errors.internal('Could not generate a referral code. Please try again.');
}

export function computeReward(code, baseAmount = 0) {
  const value = Number(code?.rewardValue ?? 0);
  if (code?.rewardType === 'FIXED') return round2(value);
  return round2((Number(baseAmount || 0) * value) / 100);
}

export function serializeCode(code, ownerLabel = null) {
  return {
    id: code.id,
    code: code.code,
    ownerType: code.ownerType,
    ownerId: code.ownerId ?? null,
    ownerLabel,
    rewardType: code.rewardType,
    rewardValue: Number(code.rewardValue),
    active: code.active,
    uses: code.uses,
    maxUses: code.maxUses ?? null,
    createdAt: code.createdAt,
    shareUrl: `${config.platform.appUrl}/register?ref=${code.code}`,
  };
}

function validateCodeShape({ rewardType, rewardValue, maxUses }) {
  if (rewardType != null && !REWARD_TYPES.includes(rewardType)) {
    throw errors.badRequest('Choose a percentage or a fixed reward.', [{ path: 'rewardType', message: 'Invalid reward type.' }]);
  }
  if (rewardValue != null) {
    const value = Number(rewardValue);
    if (!Number.isFinite(value) || value < 0) {
      throw errors.badRequest('The reward cannot be negative.', [{ path: 'rewardValue', message: 'Enter a positive number.' }]);
    }
    if (rewardType === 'PERCENT' && value > 100) {
      throw errors.badRequest('A percentage reward cannot exceed 100%.', [{ path: 'rewardValue', message: 'Maximum 100.' }]);
    }
  }
  if (maxUses != null && maxUses !== '' && (!Number.isInteger(Number(maxUses)) || Number(maxUses) < 1)) {
    throw errors.badRequest('The usage limit must be a whole number of at least 1.', [{ path: 'maxUses', message: 'Minimum 1.' }]);
  }
}

/** Create a code. `ownerId` is null only for PLATFORM codes. */
export async function createCode({ ownerType = 'TENANT', ownerId = null, rewardType = 'PERCENT', rewardValue = 0, maxUses = null, code } = {}) {
  if (!OWNER_TYPES.includes(ownerType)) {
    throw errors.badRequest('Unknown referral code owner.', [{ path: 'ownerType', message: 'Invalid owner type.' }]);
  }
  if (ownerType !== 'PLATFORM' && !ownerId) {
    throw errors.badRequest('This referral code needs an owner.', [{ path: 'ownerId', message: 'An owner is required.' }]);
  }
  validateCodeShape({ rewardType, rewardValue, maxUses });

  return prisma.$transaction(async (tx) => {
    const finalCode = normalizeCode(code) || (await uniqueCode(tx, 'TG'));
    const clash = await tx.referralCode.findUnique({ where: { code: finalCode }, select: { id: true } });
    if (clash) {
      throw errors.conflict('That referral code is already taken.', [{ path: 'code', message: 'Already taken.' }]);
    }
    try {
      return await tx.referralCode.create({
        data: {
          code: finalCode,
          ownerType,
          ownerId: ownerType === 'PLATFORM' ? null : ownerId,
          rewardType: rewardType === 'FIXED' ? 'FIXED' : 'PERCENT',
          rewardValue: round2(rewardValue ?? 0),
          maxUses: maxUses == null || maxUses === '' ? null : Math.max(1, Math.trunc(Number(maxUses))),
        },
      });
    } catch (err) {
      if (err?.code === 'P2002') {
        throw errors.conflict('That referral code is already taken.', [{ path: 'code', message: 'Already taken.' }]);
      }
      throw err;
    }
  });
}

/** A tenant's own codes (used by the referral dashboard). */
export async function listCodesForTenant(tenantId, ownerLabel = null) {
  const rows = await prisma.referralCode.findMany({
    where: { ownerType: 'TENANT', ownerId: tenantId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => serializeCode(row, ownerLabel));
}

async function findTenantCode(tenantId, id) {
  const code = await prisma.referralCode.findFirst({ where: { id, ownerType: 'TENANT', ownerId: tenantId } });
  if (!code) throw errors.notFound('Referral code not found.');
  return code;
}

export async function updateTenantCode(tenantId, id, { active, rewardType, rewardValue, maxUses }, ownerLabel = null) {
  const current = await findTenantCode(tenantId, id);
  validateCodeShape({
    rewardType: rewardType ?? current.rewardType,
    rewardValue: rewardValue ?? current.rewardValue,
    maxUses: maxUses === undefined ? current.maxUses : maxUses,
  });

  const patch = {};
  if (active != null) patch.active = Boolean(active);
  if (rewardType != null) patch.rewardType = rewardType;
  if (rewardValue != null) patch.rewardValue = round2(rewardValue);
  if (maxUses !== undefined) patch.maxUses = maxUses == null || maxUses === '' ? null : Math.max(1, Math.trunc(Number(maxUses)));

  const updated = await prisma.referralCode.update({ where: { id }, data: patch });
  return serializeCode(updated, ownerLabel);
}

export async function deleteTenantCode(tenantId, id) {
  await findTenantCode(tenantId, id);
  const used = await prisma.referral.count({ where: { codeId: id } });
  if (used > 0) {
    throw errors.badRequest('This code has already been used — deactivate it instead of deleting.');
  }
  await prisma.referralCode.delete({ where: { id } });
  return { id };
}

/* ── Public validation (register page) ────────────────────────────── */

async function ownerLabelFor(code) {
  if (code.ownerType === 'TENANT' && code.ownerId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: code.ownerId }, select: { name: true } });
    return tenant?.name ?? null;
  }
  if (code.ownerType === 'PARTNER' && code.ownerId) {
    const partner = await prisma.partner.findUnique({ where: { id: code.ownerId }, select: { name: true } });
    return partner?.name ?? null;
  }
  return code.ownerType === 'PLATFORM' ? 'TG Invoice' : null;
}

/** Never throws for an unknown code — the register page just shows/hides a hint. */
export async function validateCode(raw) {
  const code = normalizeCode(raw);
  if (!code) return { valid: false };
  const row = await prisma.referralCode.findUnique({ where: { code } });
  if (!row || !row.active) return { valid: false, code };
  if (row.maxUses != null && row.uses >= row.maxUses) {
    return { valid: false, code, reason: 'This invite has reached its limit.' };
  }
  return {
    valid: true,
    code: row.code,
    rewardType: row.rewardType,
    rewardValue: Number(row.rewardValue),
    ownerLabel: await ownerLabelFor(row),
  };
}

/* ── Attribution (called from signup) ─────────────────────────────── */

/**
 * Attribute a new business to a code. Best-effort and idempotent: returns the
 * referral (or null) and never throws, so signup can never fail because of it.
 */
export async function attributeReferral({ code, referredTenantId, referredUserId = null }) {
  try {
    const normalized = normalizeCode(code);
    if (!normalized || !referredTenantId) return null;

    return await prisma.$transaction(async (tx) => {
      const row = await tx.referralCode.findUnique({ where: { code: normalized } });
      if (!row || !row.active) return null;
      if (row.maxUses != null && row.uses >= row.maxUses) return null;
      // A business can only be referred once.
      const existing = await tx.referral.findFirst({ where: { referredTenantId } });
      if (existing) return existing;
      // …and cannot refer itself.
      if (row.ownerType === 'TENANT' && row.ownerId === referredTenantId) return null;

      const referral = await tx.referral.create({
        data: {
          codeId: row.id,
          referrerTenantId: row.ownerType === 'TENANT' ? row.ownerId : null,
          referredTenantId,
          referredUserId,
        },
      });
      await tx.referralCode.update({ where: { id: row.id }, data: { uses: { increment: 1 } } });
      return referral;
    });
  } catch (err) {
    console.error('[referral-attribute]', err?.message);
    return null;
  }
}

/* ── Referral reads ───────────────────────────────────────────────── */

export function serializeReferral(referral) {
  return {
    id: referral.id,
    status: referral.status,
    referrerTenantId: referral.referrerTenantId ?? null,
    rewardAmount: Number(referral.rewardAmount),
    rewardedAt: referral.rewardedAt ?? null,
    createdAt: referral.createdAt,
    code: referral.code
      ? { code: referral.code.code, rewardType: referral.code.rewardType, rewardValue: Number(referral.code.rewardValue) }
      : null,
    referred: referral.referredTenant
      ? {
          id: referral.referredTenant.id,
          name: referral.referredTenant.name,
          slug: referral.referredTenant.slug,
          createdAt: referral.referredTenant.createdAt,
        }
      : null,
  };
}

const REFERRAL_INCLUDE = {
  code: { select: { code: true, rewardType: true, rewardValue: true } },
  referredTenant: { select: { id: true, name: true, slug: true, createdAt: true } },
};

export async function listReferralsForTenant(tenantId, { page = 1, limit = 100 } = {}) {
  const where = { referrerTenantId: tenantId };
  const [rows, total] = await Promise.all([
    prisma.referral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: REFERRAL_INCLUDE,
    }),
    prisma.referral.count({ where }),
  ]);
  return { rows: rows.map(serializeReferral), total };
}

export async function referralStats(tenantId) {
  const [codes, grouped] = await Promise.all([
    prisma.referralCode.count({ where: { ownerType: 'TENANT', ownerId: tenantId } }),
    prisma.referral.groupBy({
      by: ['status'],
      where: { referrerTenantId: tenantId },
      _count: { _all: true },
      _sum: { rewardAmount: true },
    }),
  ]);

  const byStatus = { PENDING: 0, ACTIVE: 0, REWARDED: 0, EXPIRED: 0 };
  let totalReward = 0;
  for (const group of grouped) {
    byStatus[group.status] = group._count._all;
    totalReward += Number(group._sum.rewardAmount || 0);
  }
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  return { codes, total, byStatus, totalReward: round2(totalReward) };
}

/* ── Platform-wide reads & actions ────────────────────────────────── */

export async function listAllReferrals({ page = 1, limit = 50, status } = {}) {
  const where = status ? { status } : {};
  const [rows, total] = await Promise.all([
    prisma.referral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: REFERRAL_INCLUDE,
    }),
    prisma.referral.count({ where }),
  ]);

  const referrerIds = [...new Set(rows.map((r) => r.referrerTenantId).filter(Boolean))];
  const referrers = referrerIds.length
    ? await prisma.tenant.findMany({ where: { id: { in: referrerIds } }, select: { id: true, name: true, slug: true } })
    : [];
  const byId = new Map(referrers.map((t) => [t.id, t]));

  return {
    rows: rows.map((r) => ({
      ...serializeReferral(r),
      referrer: r.referrerTenantId ? byId.get(r.referrerTenantId) ?? null : null,
    })),
    total,
  };
}

/**
 * Mark a referral rewarded once and once only. The payout itself is out of
 * scope until platform billing exists — this records the amount owed.
 */
export async function rewardReferral(referralId, { baseAmount } = {}) {
  const referral = await prisma.referral.findUnique({
    where: { id: referralId },
    include: { code: true, referredTenant: { select: { id: true, name: true } } },
  });
  if (!referral) throw errors.notFound('Referral not found.');
  if (referral.status === 'REWARDED') {
    return { ...serializeReferral(await prisma.referral.findUnique({ where: { id: referralId }, include: REFERRAL_INCLUDE })), alreadyRewarded: true };
  }

  const isPercent = referral.code?.rewardType === 'PERCENT';
  const explicit = baseAmount != null && baseAmount !== '' ? Number(baseAmount) : null;
  const base = explicit ?? (Number(config.platform.planValue) || 0);
  if (isPercent && (!Number.isFinite(base) || base <= 0)) {
    throw errors.badRequest('Enter the plan value this percentage should be calculated from.', [
      { path: 'baseAmount', message: 'A base amount is required for percentage rewards.' },
    ]);
  }

  const updated = await prisma.referral.update({
    where: { id: referralId },
    data: { status: 'REWARDED', rewardAmount: computeReward(referral.code, base), rewardedAt: new Date() },
    include: REFERRAL_INCLUDE,
  });

  if (referral.referrerTenantId) {
    await notifyTenantAdmins({
      tenantId: referral.referrerTenantId,
      type: 'REFERRAL_REWARDED',
      title: 'Referral reward credited',
      body: `You earned a reward for referring ${referral.referredTenant?.name || 'a business'}.`,
      link: '/referrals',
      email: { subject: 'You earned a referral reward' },
    });
  }

  return serializeReferral(updated);
}

/* ── Qualification (scheduled) ────────────────────────────────────── */

/**
 * Move PENDING referrals to ACTIVE once the referred business has issued an
 * invoice, and EXPIRE referrals whose code was switched off. Idempotent.
 */
export async function qualifyReferrals({ limit = 200 } = {}) {
  const pending = await prisma.referral.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { code: true, referredTenant: { select: { id: true, name: true } } },
  });

  let activated = 0;
  let expired = 0;

  for (const referral of pending) {
    if (!referral.code?.active) {
      await prisma.referral.update({ where: { id: referral.id }, data: { status: 'EXPIRED' } });
      expired += 1;
      continue;
    }

    const invoices = await prisma.invoice.count({ where: { tenantId: referral.referredTenantId } });
    if (invoices < QUALIFY_INVOICES) continue;

    await prisma.referral.update({ where: { id: referral.id }, data: { status: 'ACTIVE' } });
    activated += 1;

    if (referral.referrerTenantId) {
      await notifyTenantAdmins({
        tenantId: referral.referrerTenantId,
        type: 'REFERRAL_ACTIVE',
        title: 'A business you referred is now active',
        body: `${referral.referredTenant?.name || 'A business'} joined with your code ${referral.code.code} and issued their first invoice.`,
        link: '/referrals',
        email: { subject: 'Your referral is now active' },
      });
    }
  }

  return { scanned: pending.length, activated, expired };
}

export default {
  normalizeCode,
  computeReward,
  serializeCode,
  serializeReferral,
  createCode,
  listCodesForTenant,
  updateTenantCode,
  deleteTenantCode,
  validateCode,
  attributeReferral,
  listReferralsForTenant,
  referralStats,
  listAllReferrals,
  rewardReferral,
  qualifyReferrals,
};
