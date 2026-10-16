import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import config from '../config.js';
import { errors } from '../utils/errors.js';
import { computeBalance, deriveInvoiceStatus } from '../utils/money.js';
import { allocateDocumentNumber } from './sequenceService.js';
import { logAudit } from './auditService.js';
import { notifyTenantAdmins } from './notificationService.js';
import { getSettings, formatMoney } from './documentService.js';
import * as gateway from './paymentGateway.js';

/**
 * PaymentIntents: the state machine behind "pay this invoice online".
 *
 *   createPaymentIntent  → PENDING + hosted-checkout URL (link you can share)
 *   settlePaymentIntent  → PENDING → SUCCEEDED + Payment + Receipt + invoice
 *                          status recomputed (webhook / verify / reconcile)
 *   failPaymentIntent    → PENDING → FAILED (declined event)
 *
 * Settlement is idempotent by construction: a PENDING → SUCCEEDED claim inside
 * the same transaction as the Payment row means a replayed webhook (gateways
 * retry aggressively) can never double-record money.
 */

const TOLERANCE = 0.001;

export function serializeIntent(intent) {
  if (!intent) return null;
  return { ...intent, amount: Number(intent.amount), metadata: intent.metadata ?? {} };
}

const newReference = () => `tgx_${crypto.randomBytes(12).toString('hex')}`;

/* ── Create ─────────────────────────────────────────────────────────── */

/**
 * Start a hosted-checkout attempt against an invoice.
 * Defaults to charging the full outstanding balance; `amount` allows a
 * partial online payment (validated against the balance server-side).
 */
export async function createPaymentIntent({ tenantId, invoiceId, userId = null, provider, amount = null }) {
  const active = gateway.activeProvider();
  const chosen = provider ? gateway.normalizeProvider(provider) : active;
  if (!chosen || !gateway.isConfigured(chosen)) throw gateway.notConfiguredError();

  const settings = await getSettings(tenantId);
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { payments: true, customer: { select: { id: true, name: true, email: true, companyName: true } } },
  });
  if (!invoice) throw errors.notFound('Invoice not found.');
  if (invoice.status === 'DRAFT') throw errors.badRequest('Save the invoice before asking the customer to pay it.');
  if (invoice.status === 'CANCELLED' || invoice.status === 'VOID') {
    throw errors.badRequest('This invoice is cancelled — it cannot be paid online.');
  }

  const outstanding = Number(computeBalance(invoice.total, invoice.payments).balanceDue);
  if (outstanding <= TOLERANCE) throw errors.badRequest('This invoice is already fully paid.');

  const chargeAmount = amount == null ? outstanding : Math.round(Number(amount) * 100) / 100;
  if (!(chargeAmount > 0)) throw errors.badRequest('The payment amount must be greater than 0.');
  if (chargeAmount > outstanding + TOLERANCE) {
    throw errors.badRequest(
      `Payment amount (${formatMoney(chargeAmount, settings)}) exceeds the outstanding balance of ${formatMoney(outstanding, settings)}.`,
      [{ path: 'amount', message: 'Payment cannot exceed the outstanding balance.' }]
    );
  }

  const currency = String(settings.currency || 'NGN').toUpperCase();
  const reference = newReference();

  // Row first: a webhook that races the gateway call must always find a row.
  const intent = await prisma.paymentIntent.create({
    data: {
      tenantId,
      invoiceId,
      customerId: invoice.customerId,
      provider: chosen,
      reference,
      amount: chargeAmount,
      currency,
      status: 'PENDING',
      createdById: userId,
      metadata: { invoiceNumber: invoice.invoiceNumber },
    },
  });

  let checkout;
  try {
    checkout = await gateway.createCheckout({
      provider: chosen,
      reference,
      amount: chargeAmount,
      currency,
      email: invoice.customer?.email || '',
      name: invoice.customer?.name || '',
      description: `Payment for invoice ${invoice.invoiceNumber}`,
      callbackUrl: config.payments.callbackUrl || undefined,
      metadata: { reference, tenantId, invoiceId },
    });
  } catch (err) {
    // The gateway flat-out rejected the request (bad key/payload): no session
    // exists, so close the intent. Transport hiccups leave it PENDING — the
    // session may exist on their side and reconciliation can still finish it.
    if (err.status >= 400 && err.status < 500) {
      await prisma.paymentIntent
        .update({
          where: { id: intent.id },
          data: { status: 'FAILED', metadata: { invoiceNumber: invoice.invoiceNumber, reason: err.message } },
        })
        .catch(() => {});
    }
    throw errors.badRequest(`Could not start checkout: ${err.message}`);
  }

  const updated = await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: { checkoutUrl: checkout.checkoutUrl, providerRef: checkout.providerRef },
  });

  await logAudit({ tenantId, userId }, 'CREATE_PAYMENT_LINK', 'invoice', {
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    description: `Payment link created for invoice ${invoice.invoiceNumber} (${formatMoney(chargeAmount, settings)} via ${chosen})`,
    metadata: { reference },
  });

  return updated;
}

/* ── Settle ─────────────────────────────────────────────────────────── */

/**
 * Record a confirmed charge against the invoice. Safe to call any number of
 * times for the same reference (webhooks retry; the client also calls the
 * verify endpoint on return from checkout).
 *
 * @param event normalized by paymentGateway.parseWebhook / verify:
 *              { amount?, currency?, paidAt?, providerRef?, event? }
 * @returns { settled?, already?, unknown?, mismatch?, rejected?, ... }
 */
export async function settlePaymentIntent({ reference, provider, event = {} }) {
  const intentRow = await prisma.paymentIntent.findUnique({ where: { reference } });
  if (!intentRow) return { unknown: true, reference };

  const settings = await getSettings(intentRow.tenantId);

  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findUnique({
      where: { id: intentRow.id },
      include: { invoice: { include: { payments: true, customer: { select: { name: true } } } } },
    });
    if (!intent) return { unknown: true, reference };
    if (intent.status === 'SUCCEEDED') return { already: true, intent };
    if (intent.status === 'FAILED' || intent.status === 'ABANDONED') return { closed: true, intent };

    const invoice = intent.invoice;
    const expected = Number(intent.amount);
    const charged = Number(event.amount ?? expected);
    const meta = (intent.metadata && typeof intent.metadata === 'object' ? intent.metadata : {});

    // The gateway charged less than we asked for — do not record a shortfall
    // as if it were payment in full.
    if (charged > 0 && charged + TOLERANCE < expected) {
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'FAILED',
          metadata: { ...meta, mismatch: { expected, charged, event: event.event || null } },
        },
      });
      return { mismatch: true, intent, expected, charged };
    }

    // Claim first: two concurrent deliveries of the same event, where one wins
    // the PENDING → SUCCEEDED transition; the loser exits without writing.
    const claim = await tx.paymentIntent.updateMany({
      where: { id: intent.id, status: 'PENDING' },
      data: {
        status: 'SUCCEEDED',
        paidAt: event.paidAt instanceof Date && !Number.isNaN(event.paidAt.getTime()) ? event.paidAt : new Date(),
        providerRef: event.providerRef || intent.providerRef,
        metadata: { ...meta, settledBy: event.event || 'verify', chargedAmount: charged },
      },
    });
    if (claim.count === 0) return { already: true, intent };

    if (invoice.status === 'CANCELLED' || invoice.status === 'VOID') {
      // Money arrived but the invoice is closed — surface it instead of
      // silently writing a payment against a dead document.
      return { rejected: true, intent };
    }

    const outstanding = Number(computeBalance(invoice.total, invoice.payments).balanceDue);

    // Invoice was settled another way while the checkout was open: keep the
    // intent SUCCEEDED (the charge happened) but record no payment — tell the
    // admins to handle the excess.
    if (outstanding <= TOLERANCE) {
      return { overpaid: true, intent, charged, outstanding: 0 };
    }

    const apply = Math.min(charged > 0 ? charged : expected, outstanding);
    const remainder = (charged > 0 ? charged : expected) - apply;

    const payment = await tx.payment.create({
      data: {
        tenantId: intent.tenantId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: apply,
        paymentDate: event.paidAt instanceof Date && !Number.isNaN(event.paidAt.getTime()) ? event.paidAt : new Date(),
        paymentMethod: 'ONLINE',
        reference: intent.reference,
        notes:
          remainder > TOLERANCE
            ? `Online payment via ${intent.provider}. Gateway charge ${formatMoney(charged, settings)}; ${formatMoney(remainder, settings)} exceeds this invoice's balance.`
            : `Online payment via ${intent.provider}.`,
        createdById: intent.createdById,
      },
    });

    const receiptNumber = await allocateDocumentNumber(tx, intent.tenantId, 'RECEIPT', settings);
    const receipt = await tx.receipt.create({
      data: {
        tenantId: intent.tenantId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        receiptNumber,
        receiptDate: payment.paymentDate,
        amount: payment.amount,
        paymentMethod: 'ONLINE',
        reference: payment.reference,
        description: `Payment received for invoice ${invoice.invoiceNumber}`,
        notes: payment.notes,
        createdById: intent.createdById,
      },
    });

    // Recompute from ALL payments — never from client or gateway data.
    const freshPayments = await tx.payment.findMany({ where: { invoiceId: invoice.id } });
    const recomputed = computeBalance(invoice.total, freshPayments);
    const status = deriveInvoiceStatus({
      total: invoice.total,
      amountPaid: recomputed.amountPaid,
      dueDate: invoice.dueDate,
      status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
    });

    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: recomputed.amountPaid, balanceDue: recomputed.balanceDue, status },
    });

    return { settled: true, intent, payment, receipt, invoice: updated, charged, applied: apply };
  });

  /* ── Post-commit side effects (never inside the money transaction) ── */

  if (result.settled) {
    await logAudit({ tenantId: result.intent.tenantId, userId: result.intent.createdById ?? null }, 'RECORD_PAYMENT', 'payment', {
      entityId: result.payment.id,
      entityLabel: result.invoice.invoiceNumber,
      description: `Payment of ${formatMoney(result.payment.amount, settings)} received via ${result.intent.provider} for invoice ${result.invoice.invoiceNumber}`,
      metadata: { reference, provider: result.intent.provider },
    });

    await notifyTenantAdmins({
      tenantId: result.intent.tenantId,
      type: 'PAYMENT_RECEIVED',
      title: `Payment received - ${formatMoney(result.payment.amount, settings)}`,
      body: `${result.invoice.customer?.name || 'A customer'} paid ${formatMoney(result.payment.amount, settings)} on invoice ${result.invoice.invoiceNumber} (${result.intent.provider}).`,
      link: `/invoices/${result.invoice.id}`,
      email: { subject: `Payment received for ${result.invoice.invoiceNumber}` },
    }).catch(() => {});
  } else if (result.overpaid) {
    await logAudit({ tenantId: result.intent.tenantId, userId: result.intent.createdById ?? null }, 'PAYMENT_LINK_OVERPAID', 'invoice', {
      entityId: result.intent.invoiceId,
      entityLabel: result.intent.metadata?.invoiceNumber || null,
      description: `Checkout settled but invoice was already paid — ${formatMoney(result.charged, settings)} received via ${result.intent.provider} needs manual handling.`,
      metadata: { reference },
    });
    await notifyTenantAdmins({
      tenantId: result.intent.tenantId,
      type: 'PAYMENT_RECEIVED',
      title: 'Online payment needs manual handling',
      body: `${formatMoney(result.charged, settings)} arrived via ${result.intent.provider} for invoice ${result.intent.metadata?.invoiceNumber || ''} that was already settled.`,
      link: `/invoices/${result.intent.invoiceId}`,
    }).catch(() => {});
  }

  return result;
}

/* ── Fail ───────────────────────────────────────────────────────────── */

/** A declined/failed gateway event: keep the attempt, never settle it. */
export async function failPaymentIntent({ reference, reason = 'Payment failed at the gateway.' }) {
  const intent = await prisma.paymentIntent.findUnique({ where: { reference } });
  if (!intent) return { unknown: true, reference };
  if (intent.status !== 'PENDING') return { closed: true, intent };

  const meta = (intent.metadata && typeof intent.metadata === 'object' ? intent.metadata : {});
  const updated = await prisma.paymentIntent.updateMany({
    where: { id: intent.id, status: 'PENDING' },
    data: { status: 'FAILED', metadata: { ...meta, reason } },
  });
  return { failed: updated.count === 1, intent };
}

/* ── Read / cancel ──────────────────────────────────────────────────── */

export async function listIntents(tenantId, invoiceId) {
  const rows = await prisma.paymentIntent.findMany({
    where: { tenantId, invoiceId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeIntent);
}

export async function cancelIntent({ tenantId, intentId }) {
  const intent = await prisma.paymentIntent.findFirst({ where: { id: intentId, tenantId } });
  if (!intent) throw errors.notFound('Payment link not found.');
  if (intent.status !== 'PENDING') throw errors.badRequest('Only pending payment links can be cancelled.');
  const updated = await prisma.paymentIntent.updateMany({
    where: { id: intent.id, status: 'PENDING' },
    data: { status: 'ABANDONED' },
  });
  if (updated.count === 0) throw errors.badRequest('Only pending payment links can be cancelled.');
  return serializeIntent({ ...intent, status: 'ABANDONED' });
}

/**
 * Client-side return path: the browser comes back from checkout and asks the
 * server to confirm with the gateway directly — never trusting the redirect.
 * Gateway trouble is reported as a message, not an error, so the UI can show
 * "still pending" instead of a dead end (webhooks/reconciliation still run).
 */
export async function verifyAndSettle({ tenantId, invoiceId, intentId }) {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, tenantId, ...(invoiceId ? { invoiceId } : {}) },
  });
  if (!intent) throw errors.notFound('Payment link not found.');
  if (intent.status !== 'PENDING') {
    return {
      intent: serializeIntent(intent),
      verification: { attempted: false, paid: intent.status === 'SUCCEEDED', message: null },
    };
  }

  try {
    const verified = await gateway.verify({ provider: intent.provider, reference: intent.reference });
    if (verified.ok) {
      await settlePaymentIntent({
        reference: intent.reference,
        provider: intent.provider,
        event: { ...verified, event: 'verify' },
      });
      const fresh = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
      return {
        intent: serializeIntent(fresh),
        verification: { attempted: true, paid: true, message: verified.message || 'Payment confirmed.' },
      };
    }
    return {
      intent: serializeIntent(intent),
      verification: { attempted: true, paid: false, message: verified.message || 'Not paid yet.' },
    };
  } catch (err) {
    return {
      intent: serializeIntent(intent),
      verification: { attempted: true, paid: false, message: `Could not reach the gateway: ${err.message}` },
    };
  }
}

/* ── Reconciliation ─────────────────────────────────────────────────── */

/**
 * Catch webhooks that never arrived (retries exhausted, provider hiccup).
 * Verifies stale PENDING intents against the gateway API and settles any that
 * were actually paid. Hourly job: `payments.reconcile`.
 */
export async function reconcileStaleIntents({ olderThanMinutes = 60, limit = 25 } = {}) {
  const report = { scanned: 0, settled: 0, unknown: 0 };
  if (!gateway.activeProvider()) return report;

  const cutoff = new Date(Date.now() - Math.max(1, olderThanMinutes) * 60 * 1000);
  const stale = await prisma.paymentIntent.findMany({
    where: { status: 'PENDING', checkoutUrl: { not: null }, createdAt: { lte: cutoff } },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, limit),
  });
  report.scanned = stale.length;

  for (const intent of stale) {
    try {
      const verified = await gateway.verify({ provider: intent.provider, reference: intent.reference });
      if (!verified.ok) continue;
      const out = await settlePaymentIntent({
        reference: intent.reference,
        provider: intent.provider,
        event: { ...verified, event: 'reconcile' },
      });
      if (out.settled || out.already) report.settled += 1;
      if (out.unknown) report.unknown += 1;
    } catch (err) {
      // A reference the gateway has never seen is normal (customer never
      // opened the link) — keep it PENDING and try again next hour.
      console.warn(`[payments] reconcile failed for ${intent.reference}: ${err.message}`);
    }
  }

  return report;
}

export default {
  serializeIntent,
  createPaymentIntent,
  settlePaymentIntent,
  failPaymentIntent,
  listIntents,
  cancelIntent,
  verifyAndSettle,
  reconcileStaleIntents,
};
