import { errors, asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import {
  TEMPLATE_KINDS,
  KIND_LABELS,
  assertKind,
  getTemplate,
  listTemplates,
  saveTemplate,
  deleteTemplate,
} from '../services/templateService.js';

/**
 * Document templates — the visual settings used when a document is rendered to
 * PDF. One default per (tenant, kind); resetting deletes the row and the
 * built-in look returns.
 */

/* ── GET /api/document-templates ──────────────────────────────────── */

export const list = asyncHandler(async (req, res) => {
  ok(res, await listTemplates(req.tenant.id), { kinds: KIND_LABELS });
});

/* ── GET /api/document-templates/:kind ────────────────────────────── */

export const get = asyncHandler(async (req, res) => {
  assertKind(req.params.kind);
  const template = await getTemplate(req.tenant.id, req.params.kind);
  ok(res, {
    id: template?.id ?? null,
    kind: req.params.kind,
    name: template?.name ?? `${KIND_LABELS[req.params.kind]} template`,
    isDefault: template?.isDefault ?? true,
    accentColor: template?.accentColor ?? null,
    showLogo: template?.showLogo ?? true,
    showBankDetails: template?.showBankDetails ?? true,
    headerNote: template?.headerNote ?? null,
    footerNote: template?.footerNote ?? null,
  });
});

/* ── PUT /api/document-templates/:kind ────────────────────────────── */

export const save = asyncHandler(async (req, res) => {
  const { kind } = req.params;
  assertKind(kind);
  const body = req.validatedBody;

  const template = await saveTemplate(req.tenant.id, kind, {
    name: body.name || undefined,
    accentColor: body.accentColor ? body.accentColor : null,
    showLogo: body.showLogo,
    showBankDetails: body.showBankDetails,
    headerNote: body.headerNote ? body.headerNote : null,
    footerNote: body.footerNote ? body.footerNote : null,
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_DOCUMENT_TEMPLATE', 'document_template', {
    entityId: template.id,
    entityLabel: KIND_LABELS[kind],
    description: `${req.user.name} updated the ${KIND_LABELS[kind].toLowerCase()} template`,
  });

  ok(res, template);
});

/* ── DELETE /api/document-templates/:kind ─────────────────────────── */

export const reset = asyncHandler(async (req, res) => {
  const { kind } = req.params;
  assertKind(kind);
  const template = await deleteTemplate(req.tenant.id, kind);

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'RESET_DOCUMENT_TEMPLATE', 'document_template', {
    entityLabel: KIND_LABELS[kind],
    description: `${req.user.name} reset the ${KIND_LABELS[kind].toLowerCase()} template to the default`,
  });

  ok(res, template);
});

export { TEMPLATE_KINDS };
