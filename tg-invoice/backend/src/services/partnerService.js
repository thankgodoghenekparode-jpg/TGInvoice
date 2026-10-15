import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';
import { PARTNER_TYPES, createCode, serializeCode } from './referralService.js';

/**
 * Reseller / accountant / affiliate partners.
 *
 * A partner is a platform-level entity that owns referral codes
 * (`ReferralCode.ownerType = 'PARTNER'`, `ownerId = partner.id`). Commission is
 * the sum of rewards credited to those codes — so there is a single source of
 * truth and no double bookkeeping. `commissionRate` records the agreed rate for
 * reference; `rewardValue` on each code is what is actually applied.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const emptyRollup = () => ({ codes: 0, activeCodes: 0, uses: 0, referrals: 0, commission: 0, byStatus: {} });

export function serializePartner(partner, rollup = null) {
  return {
    id: partner.id,
    name: partner.name,
    type: partner.type,
    email: partner.email ?? null,
    phone: partner.phone ?? null,
    companyName: partner.companyName ?? null,
    commissionRate: Number(partner.commissionRate),
    status: partner.status,
    notes: partner.notes ?? null,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
    stats: rollup
      ? {
          codes: rollup.codes,
          activeCodes: rollup.activeCodes,
          uses: rollup.uses,
          referrals: rollup.referrals,
          commission: round2(rollup.commission),
          byStatus: rollup.byStatus,
        }
      : undefined,
  };
}

function validatePartner({ type, commissionRate }) {
  if (type != null && !PARTNER_TYPES.includes(type)) {
    throw errors.badRequest('Choose a partner type.', [{ path: 'type', message: 'Invalid partner type.' }]);
  }
  if (commissionRate != null) {
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw errors.badRequest('The commission rate must be between 0 and 100.', [
        { path: 'commissionRate', message: 'Between 0 and 100.' },
      ]);
    }
  }
}

/** Referral + commission rollups for a set of partner ids, in three queries. */
async function rollupsFor(partnerIds) {
  const map = new Map(partnerIds.map((id) => [id, emptyRollup()]));
  if (!partnerIds.length) return map;

  const codes = await prisma.referralCode.findMany({
    where: { ownerType: 'PARTNER', ownerId: { in: partnerIds } },
    select: { id: true, ownerId: true, active: true, uses: true },
  });

  const codeOwner = new Map();
  for (const code of codes) {
    codeOwner.set(code.id, code.ownerId);
    const rollup = map.get(code.ownerId);
    if (!rollup) continue;
    rollup.codes += 1;
    rollup.uses += code.uses;
    if (code.active) rollup.activeCodes += 1;
  }

  if (codes.length) {
    const grouped = await prisma.referral.groupBy({
      by: ['codeId', 'status'],
      where: { codeId: { in: codes.map((c) => c.id) } },
      _count: { _all: true },
      _sum: { rewardAmount: true },
    });
    for (const group of grouped) {
      const rollup = map.get(codeOwner.get(group.codeId));
      if (!rollup) continue;
      rollup.referrals += group._count._all;
      rollup.byStatus[group.status] = (rollup.byStatus[group.status] || 0) + group._count._all;
      rollup.commission += Number(group._sum.rewardAmount || 0);
    }
  }

  return map;
}

export async function listPartners({ status, type } = {}) {
  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;

  const partners = await prisma.partner.findMany({ where, orderBy: { createdAt: 'desc' } });
  const rollups = await rollupsFor(partners.map((p) => p.id));
  return partners.map((p) => serializePartner(p, rollups.get(p.id)));
}

export async function getPartner(id) {
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) throw errors.notFound('Partner not found.');

  const rollups = await rollupsFor([id]);
  const codes = await prisma.referralCode.findMany({
    where: { ownerType: 'PARTNER', ownerId: id },
    orderBy: { createdAt: 'desc' },
  });

  return {
    ...serializePartner(partner, rollups.get(id)),
    codes: codes.map((code) => serializeCode(code, partner.name)),
  };
}

export async function createPartner({ name, type, email, phone, companyName, commissionRate, notes, userId }) {
  validatePartner({ type, commissionRate });
  const partner = await prisma.partner.create({
    data: {
      name,
      type: type || 'AFFILIATE',
      email: email || null,
      phone: phone || null,
      companyName: companyName || null,
      commissionRate: round2(commissionRate ?? 0),
      notes: notes || null,
      userId: userId ?? null,
    },
  });
  return serializePartner(partner, emptyRollup());
}

export async function updatePartner(id, data) {
  const current = await prisma.partner.findUnique({ where: { id } });
  if (!current) throw errors.notFound('Partner not found.');
  validatePartner({ type: data?.type, commissionRate: data?.commissionRate });

  const patch = {};
  for (const key of ['name', 'type', 'email', 'phone', 'companyName', 'status', 'notes']) {
    if (data[key] !== undefined) patch[key] = data[key] === '' ? null : data[key];
  }
  if (data.commissionRate != null) patch.commissionRate = round2(data.commissionRate);

  const partner = await prisma.partner.update({ where: { id }, data: patch });
  const rollups = await rollupsFor([id]);
  return serializePartner(partner, rollups.get(id));
}

export async function deletePartner(id) {
  const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true } });
  if (!partner) throw errors.notFound('Partner not found.');

  const codes = await prisma.referralCode.count({ where: { ownerType: 'PARTNER', ownerId: id } });
  if (codes > 0) {
    throw errors.badRequest('This partner owns referral codes — suspend them instead of deleting.');
  }
  await prisma.partner.delete({ where: { id } });
  return { id };
}

export async function createPartnerCode(partnerId, payload) {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) throw errors.notFound('Partner not found.');
  const code = await createCode({ ...payload, ownerType: 'PARTNER', ownerId: partnerId });
  return serializeCode(code, partner.name);
}

export default {
  serializePartner,
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  deletePartner,
  createPartnerCode,
};
