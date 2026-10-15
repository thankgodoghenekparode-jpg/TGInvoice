import api from './api.js';

/**
 * Referrals + the reseller/accountant/affiliate program.
 *
 * Two audiences share one file because they are two halves of the same
 * program: the tenant side (your codes, the businesses you brought in) and the
 * platform-admin side (partners and crediting rewards).
 */

/* ── Tenant (owner/admin) ──────────────────────────────────────────── */

export const getReferralOverview = () => api.get('/referrals').then((r) => r.data.data);

export const createReferralCode = (payload) =>
  api.post('/referrals/codes', payload).then((r) => r.data.data);

export const updateReferralCode = (id, payload) =>
  api.patch(`/referrals/codes/${id}`, payload).then((r) => r.data.data);

export const deleteReferralCode = (id) =>
  api.delete(`/referrals/codes/${id}`).then((r) => r.data.data);

/* ── Platform admin ────────────────────────────────────────────────── */

export const listPartners = () => api.get('/admin/partners').then((r) => r.data.data);

export const getPartner = (id) => api.get(`/admin/partners/${id}`).then((r) => r.data.data);

export const createPartner = (payload) =>
  api.post('/admin/partners', payload).then((r) => r.data.data);

export const updatePartner = (id, payload) =>
  api.patch(`/admin/partners/${id}`, payload).then((r) => r.data.data);

export const deletePartner = (id) =>
  api.delete(`/admin/partners/${id}`).then((r) => r.data.data);

export const createPartnerCode = (id, payload) =>
  api.post(`/admin/partners/${id}/codes`, payload).then((r) => r.data.data);

export const listAdminReferrals = (params) =>
  api.get('/admin/referrals', { params }).then((r) => ({ rows: r.data.data, meta: r.data.meta }));

export const rewardReferral = (id, payload) =>
  api.post(`/admin/referrals/${id}/reward`, payload).then((r) => r.data.data);

/* ── Public (register page) ────────────────────────────────────────── */

/** Validate an invite code before the visitor signs up. Never 404s. */
export const lookupReferralCode = (code) =>
  api.get(`/public/referral/${encodeURIComponent(code)}`).then((r) => r.data.data);

export default {
  getReferralOverview,
  createReferralCode,
  updateReferralCode,
  deleteReferralCode,
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  deletePartner,
  createPartnerCode,
  listAdminReferrals,
  rewardReferral,
  lookupReferralCode,
};
