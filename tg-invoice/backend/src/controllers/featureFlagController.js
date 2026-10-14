import { asyncHandler, errors } from '../utils/errors.js';
import * as flags from '../services/featureFlagService.js';

/**
 * Feature-flag endpoints.
 *  - `list` is public: the login/marketing pages also gate on flags. The tenant
 *    is read from the X-Tenant-Id header only to pick the rollout bucket — no
 *    data is returned, so an unverified id is harmless here.
 *  - `adminList/adminUpsert/adminRemove` are platform-admin only (see admin.routes).
 */

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.header('x-tenant-id') || null;
  const result = await flags.getFlagsForTenant(tenantId);
  res.json({ flags: result });
});

export const adminList = asyncHandler(async (_req, res) => {
  res.json({ flags: await flags.listFlagDefinitions() });
});

export const adminUpsert = asyncHandler(async (req, res) => {
  const { key, description, enabled, rollout, tenantIds } = req.body ?? {};
  if (!key || typeof key !== 'string' || !/^[a-z0-9_.:-]{2,64}$/i.test(key)) {
    throw errors.badRequest('A flag key (2–64 chars, letters/numbers/.:-_) is required.');
  }
  if (tenantIds != null && !Array.isArray(tenantIds)) {
    throw errors.badRequest('tenantIds must be an array of tenant ids.');
  }
  const flag = await flags.upsertFlag({ key, description, enabled, rollout, tenantIds });
  res.json({ flag });
});

export const adminRemove = asyncHandler(async (req, res) => {
  const flag = await flags.removeFlag(req.params.id);
  if (!flag) throw errors.notFound('Flag not found.');
  res.json({ ok: true });
});
