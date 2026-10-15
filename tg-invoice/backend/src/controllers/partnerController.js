import { asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import * as partners from '../services/partnerService.js';

/**
 * Partner (reseller / accountant / affiliate) management — platform admins only.
 * Mounted inside the admin router, so requireAuth + requirePlatformAdmin have
 * already run.
 */

export const list = asyncHandler(async (req, res) => {
  ok(res, await partners.listPartners({ status: req.query.status, type: req.query.type }));
});

export const get = asyncHandler(async (req, res) => {
  ok(res, await partners.getPartner(req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  created(res, await partners.createPartner(req.validatedBody));
});

export const update = asyncHandler(async (req, res) => {
  ok(res, await partners.updatePartner(req.params.id, req.validatedBody));
});

export const remove = asyncHandler(async (req, res) => {
  ok(res, await partners.deletePartner(req.params.id));
});

export const createCode = asyncHandler(async (req, res) => {
  created(res, await partners.createPartnerCode(req.params.id, req.validatedBody));
});
