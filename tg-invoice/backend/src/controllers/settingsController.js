import multer from 'multer';
import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { saveFile, deleteFile, getPublicUrl } from '../services/storageService.js';
import { formatNumber } from '../services/sequenceService.js';

/** GET /api/settings — the active tenant's own settings (created on first read). */
export const getSettings = asyncHandler(async (req, res) => {
  let settings = await prisma.companySettings.findUnique({ where: { tenantId: req.tenant.id } });
  if (!settings) {
    settings = await prisma.companySettings.create({
      data: { tenantId: req.tenant.id, businessName: req.tenant.name, email: req.user.email },
    });
  }

  // The next number each sequence will hand out (used by the settings hint).
  // Prefixes come from the live settings — the sequence row only owns the counter.
  const sequences = await prisma.documentSequence.findMany({ where: { tenantId: req.tenant.id } });
  const prefixFor = { INVOICE: settings.invoicePrefix, QUOTATION: settings.quotationPrefix, RECEIPT: settings.receiptPrefix, CUSTOMER: 'CUS' };
  const nextNumbers = {};
  for (const seq of sequences) nextNumbers[seq.kind] = formatNumber(prefixFor[seq.kind] || seq.prefix, seq.next);

  ok(res, { ...serialize(settings), nextNumbers });
});

/** Fields a tenant may update — explicit allowlist (no mass assignment). */
const EDITABLE = [
  'businessName', 'address', 'phone', 'email', 'website', 'taxId', 'country',
  'currency', 'currencySymbol', 'currencyPosition', 'currencyDecimals', 'defaultCurrency',
  'bankName', 'accountName', 'accountNumber', 'paymentInstructions',
  'invoicePrefix', 'quotationPrefix', 'receiptPrefix',
  'defaultTaxRate', 'defaultInvoiceNotes', 'defaultQuotationTerms', 'defaultReceiptNotes',
  'onboardingComplete',
];

/** PUT /api/settings — OWNER/ADMIN only. */
export const updateSettings = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) {
    throw errors.forbidden('Only owners and admins can change business settings.');
  }

  const data = {};
  for (const key of EDITABLE) {
    if (key in req.body) data[key] = req.body[key] === '' ? null : req.body[key];
  }

  // Prefixes feed document numbering — keep them short and clean.
  for (const p of ['invoicePrefix', 'quotationPrefix', 'receiptPrefix']) {
    if (data[p] != null) {
      const clean = String(data[p]).trim().toUpperCase().slice(0, 10);
      if (!/^[A-Z0-9-]*$/.test(clean)) throw errors.badRequest('Prefixes may only contain letters, numbers and dashes.');
      data[p] = clean;
    }
  }

  const settings = await prisma.companySettings.upsert({
    where: { tenantId: req.tenant.id },
    create: { tenantId: req.tenant.id, businessName: req.tenant.name, ...pickCreated(data) },
    update: data,
  });

  if (data.businessName) {
    await prisma.tenant.update({ where: { id: req.tenant.id }, data: { name: data.businessName } });
  }

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_SETTINGS', 'settings', {
    entityId: settings.id,
    description: `${req.user.name} updated company settings`,
  });

  ok(res, serialize(settings));
});

/* ── Logo upload (storage abstraction — swappable for cloud storage) ── */

export const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(errors.badRequest('Upload a PNG, JPG or WEBP image.'));
  },
}).single('logo');

export const setLogo = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can change the logo.');
  if (!req.file) throw errors.badRequest('Choose an image to upload.');

  const key = await saveFile(req.file.buffer, { folder: `logos/${req.tenant.id}`, ext: req.file.mimetype.split('/')[1] });

  const settings = await prisma.companySettings.upsert({
    where: { tenantId: req.tenant.id },
    create: { tenantId: req.tenant.id, businessName: req.tenant.name, logo: key },
    update: { logo: key },
  });
  const tenant = await prisma.tenant.update({ where: { id: req.tenant.id }, data: { logo: key } });

  // Best-effort cleanup of the previous logo.
  const previous = req.body?.previous || null;
  if (previous && previous !== key) await deleteFile(previous).catch(() => {});

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_SETTINGS', 'settings', {
    description: `${req.user.name} updated the business logo`,
  });

  ok(res, { ...serialize(settings), logo: getPublicUrl(key), tenantLogo: getPublicUrl(tenant.logo) });
});

export const removeLogo = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can change the logo.');

  const settings = await prisma.companySettings.findUnique({ where: { tenantId: req.tenant.id } });
  if (settings?.logo) await deleteFile(settings.logo).catch(() => {});

  await prisma.companySettings.update({ where: { tenantId: req.tenant.id }, data: { logo: null } });
  await prisma.tenant.update({ where: { id: req.tenant.id }, data: { logo: null } });

  ok(res, { logo: null });
});

/* ── helpers ──────────────────────────────────────────────────────── */

function serialize(s) {
  return {
    ...s,
    logo: getPublicUrl(s.logo),
    defaultTaxRate: Number(s.defaultTaxRate),
    defaultInvoiceNotes: s.defaultInvoiceNotes ?? '',
    defaultQuotationTerms: s.defaultQuotationTerms ?? '',
    defaultReceiptNotes: s.defaultReceiptNotes ?? '',
  };
}

function pickCreated(data) {
  const out = {};
  for (const key of EDITABLE) if (key in data) out[key] = data[key];
  return out;
}
