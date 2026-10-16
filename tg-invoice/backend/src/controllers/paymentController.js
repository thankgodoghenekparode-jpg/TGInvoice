import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/errors.js';
import { ok, created, parseListQuery, searchFilter } from '../utils/query.js';
import * as paymentService from '../services/paymentService.js';
import { logAudit } from '../services/auditService.js';

const SORTABLE = ['paymentDate', 'amount', 'createdAt', 'paymentMethod'];

/**
 * GET /api/payments — tenant-wide payment history
 * (customer detail Payments tab, reports).
 */
export const listPayments = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-paymentDate' });

  const where = {
    tenantId: req.tenant.id,
    ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
    ...(req.query.invoiceId ? { invoiceId: req.query.invoiceId } : {}),
    ...(req.query.method ? { paymentMethod: req.query.method } : {}),
    ...(req.query.from || req.query.to
      ? {
          paymentDate: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: endOfDay(req.query.to) } : {}),
          },
        }
      : {}),
    ...searchFilter(req.query.search, ['reference', 'invoice.invoiceNumber', 'customer.name', 'customer.companyName']),
  };

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
        receipt: { select: { id: true, receiptNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  ok(res, rows.map((p) => ({ ...p, amount: Number(p.amount) })), {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

function endOfDay(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

/* ── Hosted payment links (Paystack / Flutterwave) ─────────────────────
   The invoice number path param scopes every lookup to the tenant's own
   invoice, so another business's intents are unreachable either way.    */

/** POST /api/invoices/:id/payment-link — open a hosted checkout session. */
export const createPaymentLink = asyncHandler(async (req, res) => {
  const b = req.validatedBody || {};
  const intent = await paymentService.createPaymentIntent({
    tenantId: req.tenant.id,
    invoiceId: req.params.id,
    userId: req.user.id,
    provider: b.provider,
    amount: b.amount ?? null,
  });
  created(res, paymentService.serializeIntent(intent));
});

/** GET /api/invoices/:id/payment-links — attempts against this invoice. */
export const listPaymentLinks = asyncHandler(async (req, res) => {
  const rows = await paymentService.listIntents(req.tenant.id, req.params.id);
  ok(res, rows);
});

/**
 * POST /api/invoices/:id/payment-links/:intentId/verify — confirm directly
 * with the gateway after the browser returns from checkout. Gateway trouble
 * comes back as `verification.message`, not an HTTP error: the link is still
 * valid and webhooks/reconciliation keep running.
 */
export const verifyPaymentLink = asyncHandler(async (req, res) => {
  const out = await paymentService.verifyAndSettle({
    tenantId: req.tenant.id,
    invoiceId: req.params.id,
    intentId: req.params.intentId,
  });
  ok(res, out.intent, { verification: out.verification });
});

/** POST /api/invoices/:id/payment-links/:intentId/cancel — stop the link. */
export const cancelPaymentLink = asyncHandler(async (req, res) => {
  const intent = await paymentService.cancelIntent({ tenantId: req.tenant.id, intentId: req.params.intentId });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CANCEL_PAYMENT_LINK', 'invoice', {
    entityId: intent.invoiceId,
    entityLabel: intent.metadata?.invoiceNumber || null,
    description: `Payment link cancelled for invoice ${intent.metadata?.invoiceNumber || ''} (${intent.provider})`,
    metadata: { reference: intent.reference },
  });

  ok(res, intent);
});
