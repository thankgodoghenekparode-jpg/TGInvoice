import { asyncHandler } from '../utils/errors.js';
import { ok, created, parseListQuery } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import * as referrals from '../services/referralService.js';

/**
 * Referral endpoints for a business (owner/admin) and, in the same controller,
 * the platform-admin views and the reward action.
 */

const STATUSES = ['PENDING', 'ACTIVE', 'REWARDED', 'EXPIRED'];

/* ── GET /api/referrals ───────────────────────────────────────────── */

export const overview = asyncHandler(async (req, res) => {
  const [codes, list, stats] = await Promise.all([
    referrals.listCodesForTenant(req.tenant.id, req.tenant.name),
    referrals.listReferralsForTenant(req.tenant.id, { page: 1, limit: 100 }),
    referrals.referralStats(req.tenant.id),
  ]);
  ok(res, { codes, referrals: list.rows, stats });
});

/* ── Codes (owner/admin) ──────────────────────────────────────────── */

export const createCode = asyncHandler(async (req, res) => {
  const code = await referrals.createCode({
    ownerType: 'TENANT',
    ownerId: req.tenant.id,
    rewardType: req.validatedBody.rewardType,
    rewardValue: req.validatedBody.rewardValue,
    maxUses: req.validatedBody.maxUses,
    code: req.validatedBody.code,
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_REFERRAL_CODE', 'referral', {
    entityId: code.id,
    entityLabel: code.code,
    description: `${req.user.name} created referral code ${code.code}`,
  });

  created(res, referrals.serializeCode(code, req.tenant.name));
});

export const updateCode = asyncHandler(async (req, res) => {
  const updated = await referrals.updateTenantCode(req.tenant.id, req.params.id, req.validatedBody, req.tenant.name);

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_REFERRAL_CODE', 'referral', {
    entityId: updated.id,
    entityLabel: updated.code,
    description: `${req.user.name} updated referral code ${updated.code}`,
  });

  ok(res, updated);
});

export const deleteCode = asyncHandler(async (req, res) => {
  const result = await referrals.deleteTenantCode(req.tenant.id, req.params.id);

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_REFERRAL_CODE', 'referral', {
    entityId: result.id,
    description: `${req.user.name} deleted a referral code`,
  });

  ok(res, result);
});

/* ── Platform-wide (super-admin) ──────────────────────────────────── */

export const adminList = asyncHandler(async (req, res) => {
  const { page, limit } = parseListQuery(req.query, { sortAllowlist: [], defaultSort: '-createdAt', maxLimit: 200 });
  const status = STATUSES.includes(req.query.status) ? req.query.status : undefined;
  const result = await referrals.listAllReferrals({ page, limit, status });
  ok(res, result.rows, { total: result.total, page, limit, status: status ?? null });
});

export const adminReward = asyncHandler(async (req, res) => {
  const result = await referrals.rewardReferral(req.params.id, { baseAmount: req.validatedBody?.baseAmount });

  if (result.referrerTenantId) {
    await logAudit({ tenantId: result.referrerTenantId, userId: req.user.id }, 'REWARD_REFERRAL', 'referral', {
      entityId: result.id,
      description: `Platform admin ${req.user.name} credited a referral reward of ${result.rewardAmount}`,
    });
  }

  ok(res, result);
});
