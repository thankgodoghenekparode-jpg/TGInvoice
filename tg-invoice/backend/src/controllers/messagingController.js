import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { getSettings } from '../services/documentService.js';
import { messagingStatus } from '../services/messagingService.js';
import { KIND_META, loadDocument, deliverDocument, sanitizeChannels } from '../services/documentDeliveryService.js';

const AUDIT_ACTION = { INVOICE: 'SEND_INVOICE', QUOTATION: 'SEND_QUOTATION', RECEIPT: 'SEND_RECEIPT' };

/**
 * Delivery over WhatsApp (Cloud API) / SMS / email.
 *   GET  /api/messages/status        → which providers are configured
 *   GET  /api/messages               → delivery log (what went out, to whom, when)
 *   POST /api/{invoices|quotations|receipts}/:id/deliver
 */

/* ── GET /api/messages/status ─────────────────────────────────────── */

export const status = asyncHandler(async (_req, res) => {
  ok(res, messagingStatus());
});

/* ── GET /api/messages ────────────────────────────────────────────── */

export const listLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let limit = parseInt(req.query.limit, 10) || 20;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;

  const where = { tenantId: req.tenant.id };
  if (req.query.channel) where.channel = String(req.query.channel).toUpperCase();
  if (req.query.status) where.status = String(req.query.status).toUpperCase();

  const [rows, total] = await Promise.all([
    prisma.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.messageLog.count({ where }),
  ]);

  return ok(res, rows, { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

/* ── POST /api/{invoices|quotations|receipts}/:id/deliver ─────────── */

export const deliver_document = (kind) =>
  asyncHandler(async (req, res) => {
    const meta = KIND_META[kind];
    const document = await loadDocument(kind, req.params.id, req.tenant.id);
    if (kind === 'RECEIPT' && document.status === 'VOID') {
      throw errors.badRequest('This receipt has been voided and cannot be sent.');
    }

    const channels = sanitizeChannels(req.body?.channels);
    if (!channels.length) throw errors.badRequest('Choose at least one delivery channel (EMAIL, WHATSAPP or SMS).');

    const settings = await getSettings(req.tenant.id);
    const { results, previewUrl } = await deliverDocument({
      kind,
      document,
      settings,
      channels,
      to: req.body?.to,
      message: req.body?.message,
      subject: req.body?.subject,
    });

    // Mark sent when at least one channel actually delivered.
    const anySent = results.some((r) => r.sent);
    if (anySent && kind === 'INVOICE' && ['DRAFT', 'UNPAID'].includes(document.status)) {
      await prisma.invoice.update({ where: { id: document.id }, data: { status: 'SENT' } });
    }
    if (anySent && kind === 'QUOTATION' && document.status === 'DRAFT') {
      await prisma.quotation.update({ where: { id: document.id }, data: { status: 'SENT' } });
    }

    const delivered = results.filter((r) => r.sent).map((r) => r.channel).join(', ');
    await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, AUDIT_ACTION[kind], meta.model, {
      entityId: document.id,
      entityLabel: document[meta.number],
      description: delivered
        ? `${req.user.name} sent ${meta.label.toLowerCase()} ${document[meta.number]} via ${delivered}`
        : `${req.user.name} attempted to send ${meta.label.toLowerCase()} ${document[meta.number]} (no channel delivered)`,
    });

    ok(res, { results, previewUrl, anySent });
  });
