import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';

/**
 * Document templates — the visual settings applied when a quotation, invoice,
 * receipt or credit note is rendered to PDF. One default per (tenant, kind);
 * anything left null/true falls back to the built-in look.
 */

export const TEMPLATE_KINDS = ['QUOTATION', 'INVOICE', 'RECEIPT', 'CREDIT_NOTE'];

export const KIND_LABELS = {
  QUOTATION: 'Quotation',
  INVOICE: 'Invoice',
  RECEIPT: 'Receipt',
  CREDIT_NOTE: 'Credit note',
};

export const DEFAULT_TEMPLATE = {
  accentColor: null,
  showLogo: true,
  showBankDetails: true,
  headerNote: null,
  footerNote: null,
};

export function assertKind(kind) {
  if (!TEMPLATE_KINDS.includes(kind)) {
    throw errors.badRequest('Choose a valid document type.', [{ path: 'kind', message: 'Unknown document type.' }]);
  }
}

export function serializeTemplate(template, kind) {
  return {
    id: template?.id ?? null,
    kind: template?.kind ?? kind,
    name: template?.name ?? `${KIND_LABELS[kind] || kind} template`,
    isDefault: template?.isDefault ?? true,
    ...DEFAULT_TEMPLATE,
    ...(template
      ? {
          accentColor: template.accentColor,
          showLogo: template.showLogo,
          showBankDetails: template.showBankDetails,
          headerNote: template.headerNote,
          footerNote: template.footerNote,
        }
      : {}),
  };
}

/** The default template for a kind, or null when the tenant never saved one. */
export async function getTemplate(tenantId, kind) {
  if (!tenantId || !TEMPLATE_KINDS.includes(kind)) return null;
  return prisma.documentTemplate.findFirst({
    where: { tenantId, kind },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}

export async function listTemplates(tenantId) {
  const rows = await prisma.documentTemplate.findMany({ where: { tenantId } });
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return TEMPLATE_KINDS.map((kind) => serializeTemplate(byKind.get(kind), kind));
}

/** Create or update the single default template for (tenant, kind). */
export async function saveTemplate(tenantId, kind, data) {
  assertKind(kind);
  const existing = await prisma.documentTemplate.findFirst({ where: { tenantId, kind } });
  const payload = {
    name: data.name || `${KIND_LABELS[kind]} template`,
    accentColor: data.accentColor ?? null,
    showLogo: data.showLogo ?? true,
    showBankDetails: data.showBankDetails ?? true,
    headerNote: data.headerNote ?? null,
    footerNote: data.footerNote ?? null,
  };

  const saved = existing
    ? await prisma.documentTemplate.update({ where: { id: existing.id }, data: payload })
    : await prisma.documentTemplate.create({ data: { tenantId, kind, isDefault: true, ...payload } });

  return serializeTemplate(saved, kind);
}

/** Reset a kind back to the built-in look. */
export async function deleteTemplate(tenantId, kind) {
  assertKind(kind);
  await prisma.documentTemplate.deleteMany({ where: { tenantId, kind } });
  return serializeTemplate(null, kind);
}
