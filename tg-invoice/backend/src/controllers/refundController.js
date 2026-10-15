import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created, parseListQuery, searchFilter } from '../utils/query.js';
import { round2 } from '../utils/money.js';
import { allocateDocumentNumber } from '../services/sequenceService.js';
import { logAudit } from '../services/auditService.js';
import { getSettings, formatMoney } from '../services/documentService.js';

const SORTABLE = ['refundNumber', 'refundDate', 'amount', 'status', 'createdAt'];

const REFUND_INCLUDE = {
  customer: { select: { id: true, name: true, companyName: true, email: true, phone: true } },
  invoice: { select: { id: true, invoiceNumber: true } },
  creditNote: { select: { id: true, creditNoteNumber: true } },
  payment: { select: { id: true, amount: true, paymentMethod: true } },
  createdBy: { select: { id: true, name: true } },
};

/**
 * Refunds — money paid back to a customer. Stored as their own record (never a
 * negative Payment) so cash-out is auditable and dashboards stay honest.
 *
 * A refund may be tied to an invoice, a credit note, or a specific payment;
 * when it is, the amount is capped by what is still refundable on that source.
 */

function serializeRefund(r) {
  return { ...r, amount: Number(r.amount) };
}

/* ── GET /api/refunds ─────────────────────────────────────────────── */

export const listRefunds = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-refundDate' });

  const where = {
    tenantId: req.tenant.id,
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
    ...(req.query.invoiceId ? { invoiceId: req.query.invoiceId } : {}),
    ...(req.query.from || req.query.to
      ? {
          refundDate: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: endOfDay(req.query.to) } : {}),
          },
        }
      : {}),
    ...searchFilter(req.query.search, ['refundNumber', 'reference', 'reason', 'customer.name', 'customer.companyName']),
  };

  const [rows, total, agg] = await Promise.all([
    prisma.refund.findMany({ where, include: REFUND_INCLUDE, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.refund.count({ where }),
    prisma.refund.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { amount: true } }),
  ]);

  ok(res, rows.map(serializeRefund), {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    totalRefunded: Number(agg._sum.amount || 0),
  });
});

/* ── GET /api/refunds/:id ─────────────────────────────────────────── */

export const getRefund = asyncHandler(async (req, res) => {
  const refund = await prisma.refund.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: REFUND_INCLUDE,
  });
  if (!refund) throw errors.notFound('Refund not found.');
  ok(res, serializeRefund(refund));
});

/* ── POST /api/refunds ────────────────────────────────────────────── */

export const createRefund = asyncHandler(async (req, res) => {
  const b = req.validatedBody;
  const settings = await getSettings(req.tenant.id);

  const refund = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: b.customerId, tenantId: req.tenant.id }, select: { id: true } });
    if (!customer) {
      throw errors.badRequest('Select a valid customer.', [{ path: 'customerId', message: 'Customer not found in this business.' }]);
    }

    const amount = round2(b.amount);
    let creditNote = null;
    let invoice = null;
    let payment = null;

    if (b.creditNoteId) {
      creditNote = await tx.creditNote.findFirst({ where: { id: b.creditNoteId, tenantId: req.tenant.id } });
      if (!creditNote) throw errors.badRequest('Select a valid credit note.', [{ path: 'creditNoteId', message: 'Credit note not found.' }]);
      if (creditNote.customerId !== b.customerId) throw errors.badRequest('The credit note belongs to a different customer.');
      if (creditNote.status === 'DRAFT') throw errors.badRequest('Issue the credit note before refunding it.');
      if (creditNote.status === 'VOID') throw errors.badRequest('This credit note has been voided and cannot be refunded.');

      const refunded = await sumRefunds(tx, req.tenant.id, { creditNoteId: creditNote.id });
      // Only credit that has NOT been absorbed by an invoice can be paid out in cash.
      const available = Number(round2(Number(creditNote.total) - Number(creditNote.amountApplied) - refunded));
      if (Number(amount) > available + 0.001) {
        throw errors.badRequest(
          `Refund (${formatMoney(amount, settings)}) exceeds the refundable credit of ${formatMoney(available, settings)} on credit note ${creditNote.creditNoteNumber}.`
        );
      }
    } else if (b.invoiceId) {
      invoice = await tx.invoice.findFirst({ where: { id: b.invoiceId, tenantId: req.tenant.id } });
      if (!invoice) throw errors.badRequest('Select a valid invoice.', [{ path: 'invoiceId', message: 'Invoice not found.' }]);
      if (invoice.customerId !== b.customerId) throw errors.badRequest('The invoice belongs to a different customer.');

      const refunded = await sumRefunds(tx, req.tenant.id, { invoiceId: invoice.id });
      const available = Number(round2(Number(invoice.amountPaid) - refunded));
      if (Number(amount) > available + 0.001) {
        throw errors.badRequest(
          `Refund (${formatMoney(amount, settings)}) exceeds the refundable amount of ${formatMoney(available, settings)} already received for invoice ${invoice.invoiceNumber}.`
        );
      }
    } else if (b.paymentId) {
      payment = await tx.payment.findFirst({ where: { id: b.paymentId, tenantId: req.tenant.id } });
      if (!payment) throw errors.badRequest('Select a valid payment.', [{ path: 'paymentId', message: 'Payment not found.' }]);
      if (payment.customerId !== b.customerId) throw errors.badRequest('The payment belongs to a different customer.');

      const refunded = await sumRefunds(tx, req.tenant.id, { paymentId: payment.id });
      const available = Number(round2(Number(payment.amount) - refunded));
      if (Number(amount) > available + 0.001) {
        throw errors.badRequest(
          `Refund (${formatMoney(amount, settings)}) exceeds the refundable amount of ${formatMoney(available, settings)} on that payment.`
        );
      }
    }

    const refundNumber = await allocateDocumentNumber(tx, req.tenant.id, 'REFUND', settings);
    return tx.refund.create({
      data: {
        tenantId: req.tenant.id,
        customerId: b.customerId,
        invoiceId: invoice?.id || null,
        creditNoteId: creditNote?.id || null,
        paymentId: payment?.id || null,
        refundNumber,
        amount,
        refundDate: b.refundDate || new Date(),
        method: b.method,
        reference: b.reference || null,
        reason: b.reason || null,
        notes: b.notes || null,
        status: 'COMPLETED',
        createdById: req.user.id,
      },
      include: REFUND_INCLUDE,
    });
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_REFUND', 'refund', {
    entityId: refund.id,
    entityLabel: refund.refundNumber,
    description: `${req.user.name} recorded refund ${refund.refundNumber} of ${formatMoney(refund.amount, settings)}`,
    metadata: { invoiceId: refund.invoiceId, creditNoteId: refund.creditNoteId, paymentId: refund.paymentId },
  });

  created(res, serializeRefund(refund));
});

/* ── POST /api/refunds/:id/void (OWNER/ADMIN) ─────────────────────── */

export const voidRefund = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can void refunds.');

  const existing = await prisma.refund.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Refund not found.');
  if (existing.status === 'VOID') throw errors.badRequest('This refund is already void.');

  const reason = String(req.body?.reason || '').slice(0, 500);
  const refund = await prisma.refund.update({
    where: { id: existing.id },
    data: { status: 'VOID', voidReason: reason || null },
    include: REFUND_INCLUDE,
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'VOID_REFUND', 'refund', {
    entityId: refund.id,
    entityLabel: refund.refundNumber,
    description: `${req.user.name} voided refund ${refund.refundNumber}${reason ? ` — ${reason}` : ''}`,
  });

  ok(res, serializeRefund(refund));
});

/* ── helpers ──────────────────────────────────────────────────────── */

async function sumRefunds(tx, tenantId, where) {
  const agg = await tx.refund.aggregate({
    where: { tenantId, ...where, status: 'COMPLETED' },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount || 0);
}

function endOfDay(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}
