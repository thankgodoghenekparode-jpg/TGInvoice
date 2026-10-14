import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created, parseListQuery, searchFilter } from '../utils/query.js';
import { calculateDocumentTotals, computeBalance, deriveInvoiceStatus } from '../utils/money.js';
import { allocateDocumentNumber } from '../services/sequenceService.js';
import { logAudit } from '../services/auditService.js';
import { notifyTenantAdmins } from '../services/notificationService.js';
import { saveCustomItemsAsProducts } from '../services/productCatalogService.js';
import {
  getSettings,
  buildDocumentPdf,
  emailDocument,
  sharePayload,
  previewUrlFor,
  formatMoney,
  CUSTOMER_SELECT,
} from '../services/documentService.js';

const SORTABLE = ['invoiceNumber', 'invoiceDate', 'dueDate', 'total', 'balanceDue', 'status', 'createdAt'];
const LIST_INCLUDE = { customer: { select: { id: true, name: true, companyName: true, phone: true, email: true } } };

/**
 * Recompute stored statuses where time or payments may have changed them
 * (e.g. UNPAID → OVERDUE once the due date passes). Cheap, indexed, and
 * always derived on the server — the client can never set these.
 */
export async function syncInvoiceStatuses(tenantId) {
  const now = new Date();

  // Fast path: everything past due with an outstanding balance → OVERDUE.
  await prisma.invoice.updateMany({
    where: {
      tenantId,
      status: { in: ['UNPAID', 'SENT', 'PARTIALLY_PAID'] },
      dueDate: { lt: now },
      amountPaid: { lt: prisma.invoice.fields.total },
    },
    data: { status: 'OVERDUE' },
  });

  // Rows whose stored status no longer matches reality (came due, paid off…).
  const rows = await prisma.invoice.findMany({
    where: {
      tenantId,
      status: { in: ['OVERDUE', 'UNPAID', 'PARTIALLY_PAID', 'SENT'] },
      OR: [
        { status: 'OVERDUE', dueDate: { gte: now } },
        { status: 'OVERDUE', dueDate: null },
        { amountPaid: { gte: prisma.invoice.fields.total } },
      ],
    },
    take: 500,
    select: { id: true, total: true, amountPaid: true, dueDate: true, status: true },
  });

  for (const row of rows) {
    const status = deriveInvoiceStatus(row);
    if (status !== row.status) {
      await prisma.invoice.update({ where: { id: row.id }, data: { status } });
    }
  }
}

async function assertTenantReferences(tenantId, { customerId, items, quotationId }) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
  if (!customer) throw errors.badRequest('Select a valid customer.', [{ path: 'customerId', message: 'Customer not found in this business.' }]);

  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length) {
    const count = await prisma.product.count({ where: { id: { in: productIds }, tenantId } });
    if (count !== productIds.length) throw errors.badRequest('One or more items reference a product that does not exist in this business.');
  }

  if (quotationId) {
    const quotation = await prisma.quotation.findFirst({ where: { id: quotationId, tenantId }, select: { id: true } });
    if (!quotation) throw errors.badRequest('Linked quotation not found in this business.');
  }
}

function lineRows(items) {
  return items.map((it, index) => ({
    productId: it.productId || null,
    description: it.description,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discountType: it.discountType ?? null,
    discountValue: it.discountValue ?? 0,
    discountAmount: it.discountAmount,
    taxRate: it.taxRate ?? 0,
    taxAmount: it.taxAmount,
    amount: it.amount,
    position: index,
  }));
}

/* ── GET /api/invoices ────────────────────────────────────────────── */

export const listInvoices = asyncHandler(async (req, res) => {
  await syncInvoiceStatuses(req.tenant.id);
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-invoiceDate' });

  const where = {
    tenantId: req.tenant.id,
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
    ...(req.query.overdue === 'true' ? { status: 'OVERDUE' } : {}),
    ...(req.query.outstanding === 'true' ? { balanceDue: { gt: 0 }, status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] } } : {}),
    ...(req.query.from || req.query.to
      ? {
          invoiceDate: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: endOfDay(req.query.to) } : {}),
          },
        }
      : {}),
    ...searchFilter(req.query.search, ['invoiceNumber', 'reference', 'customer.name', 'customer.companyName']),
  };

  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({ where, include: LIST_INCLUDE, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.invoice.count({ where }),
  ]);

  ok(res, rows.map(serialize), { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

/* ── GET /api/invoices/:id ────────────────────────────────────────── */

export const getInvoice = asyncHandler(async (req, res) => {
  await syncInvoiceStatuses(req.tenant.id);
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id }, // tenant-scoped lookup
    include: {
      customer: { select: CUSTOMER_SELECT },
      items: true,
      quotation: { select: { id: true, quotationNumber: true, status: true } },
      payments: { orderBy: { paymentDate: 'desc' }, include: { createdBy: { select: { id: true, name: true } }, receipt: { select: { id: true, receiptNumber: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!invoice) throw errors.notFound('Invoice not found.');
  ok(res, serialize(invoice));
});

/* ── POST /api/invoices ───────────────────────────────────────────── */

export const createInvoice = asyncHandler(async (req, res) => {
  const b = req.validatedBody;
  const settings = await getSettings(req.tenant.id);
  await assertTenantReferences(req.tenant.id, b);

  const totals = calculateDocumentTotals(b.items);

  const { invoice, savedProducts } = await prisma.$transaction(async (tx) => {
    const savedProducts = b.saveCustomItems === false ? [] : await saveCustomItemsAsProducts(tx, req.tenant.id, totals.items);
    const invoiceNumber = await allocateDocumentNumber(tx, req.tenant.id, 'INVOICE', settings);
    const invoice = await tx.invoice.create({
      data: {
        tenantId: req.tenant.id,
        customerId: b.customerId,
        quotationId: b.quotationId || null,
        invoiceNumber,
        invoiceDate: b.invoiceDate,
        dueDate: b.dueDate || null,
        reference: b.reference || null,
        status: b.status || 'UNPAID',
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        amountPaid: 0,
        balanceDue: totals.total, // server-computed
        notes: b.notes || settings.defaultInvoiceNotes || null,
        terms: b.terms || null,
        createdById: req.user.id,
        items: { create: lineRows(totals.items) },
      },
      include: { customer: true, items: true },
    });
    return { invoice, savedProducts };
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_INVOICE', 'invoice', {
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    description: `${req.user.name} created invoice ${invoice.invoiceNumber}`,
  });
  await logSavedProducts(req, savedProducts);

  created(res, serialize(invoice));
});

/* ── PUT /api/invoices/:id ────────────────────────────────────────── */

export const updateInvoice = asyncHandler(async (req, res) => {
  const existing = await prisma.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { payments: { select: { id: true } } },
  });
  if (!existing) throw errors.notFound('Invoice not found.');
  if (existing.status === 'CANCELLED' || existing.status === 'VOID') {
    throw errors.badRequest('Cancelled invoices cannot be edited.');
  }
  if (existing.payments.length > 0) {
    throw errors.badRequest('This invoice has recorded payments and can no longer be edited. Cancel it instead if the invoice was issued in error.');
  }

  const b = req.validatedBody;
  await assertTenantReferences(req.tenant.id, b);
  const totals = calculateDocumentTotals(b.items);

  const { invoice, savedProducts } = await prisma.$transaction(async (tx) => {
    const savedProducts = b.saveCustomItems === false ? [] : await saveCustomItemsAsProducts(tx, req.tenant.id, totals.items);
    await tx.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });
    const invoice = await tx.invoice.update({
      where: { id: existing.id },
      data: {
        customerId: b.customerId,
        invoiceDate: b.invoiceDate,
        dueDate: b.dueDate || null,
        reference: b.reference || null,
        status: b.status === 'DRAFT' ? 'DRAFT' : existing.status === 'DRAFT' ? 'UNPAID' : existing.status,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        amountPaid: 0,
        balanceDue: totals.total,
        notes: b.notes || null,
        terms: b.terms || null,
        items: { create: lineRows(totals.items) },
      },
      include: { customer: true, items: true },
    });
    return { invoice, savedProducts };
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_INVOICE', 'invoice', {
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    description: `${req.user.name} edited invoice ${invoice.invoiceNumber}`,
  });
  await logSavedProducts(req, savedProducts);

  ok(res, serialize(invoice));
});

/* ── DELETE /api/invoices/:id — only clean drafts ─────────────────── */

export const deleteInvoice = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can delete invoices.');

  const existing = await prisma.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { payments: { select: { id: true } } },
  });
  if (!existing) throw errors.notFound('Invoice not found.');
  if (existing.payments.length > 0) {
    throw errors.badRequest('This invoice has payments and cannot be deleted — its financial history must be preserved. Cancel the invoice instead.');
  }
  if (existing.status !== 'DRAFT') {
    throw errors.badRequest('Only draft invoices can be deleted. Cancel this invoice instead so its number is preserved in the audit trail.');
  }

  await prisma.invoice.delete({ where: { id: existing.id } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_INVOICE', 'invoice', {
    entityId: existing.id,
    entityLabel: existing.invoiceNumber,
    description: `${req.user.name} deleted draft invoice ${existing.invoiceNumber}`,
  });

  ok(res, { message: 'Invoice deleted.' });
});

/* ── POST /api/invoices/:id/cancel — the safe path for financial records ── */

export const cancelInvoice = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can cancel invoices.');

  const existing = await prisma.invoice.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Invoice not found.');
  if (existing.status === 'CANCELLED' || existing.status === 'VOID') throw errors.badRequest('This invoice is already cancelled.');

  const reason = String(req.body?.reason || '').slice(0, 500);
  const invoice = await prisma.invoice.update({
    where: { id: existing.id },
    data: { status: 'CANCELLED', voidReason: reason || null },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CANCEL_INVOICE', 'invoice', {
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    description: `${req.user.name} cancelled invoice ${invoice.invoiceNumber}${reason ? ` — ${reason}` : ''}`,
  });

  ok(res, serialize(invoice));
});

export const markInvoiceSent = asyncHandler(async (req, res) => {
  const existing = await prisma.invoice.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Invoice not found.');

  const invoice =
    ['DRAFT', 'UNPAID'].includes(existing.status)
      ? await prisma.invoice.update({ where: { id: existing.id }, data: { status: 'SENT' } })
      : existing;

  ok(res, serialize(invoice));
});

/* ── POST /api/invoices/:id/payments — record payment + auto receipt ── */

export const recordPayment = asyncHandler(async (req, res) => {
  const b = req.validatedBody;
  const settings = await getSettings(req.tenant.id);

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: req.params.id, tenantId: req.tenant.id },
      include: { payments: true },
    });
    if (!invoice) throw errors.notFound('Invoice not found.');
    if (invoice.status === 'DRAFT') throw errors.badRequest('Save the invoice before recording payments against it.');
    if (invoice.status === 'CANCELLED' || invoice.status === 'VOID') throw errors.badRequest('Payments cannot be recorded on a cancelled invoice.');

    // amount > 0 AND amount ≤ outstanding balance (validated server-side).
    const balance = computeBalance(invoice.total, invoice.payments);
    const outstanding = Number(balance.balanceDue);
    if (b.amount > outstanding + 0.001) {
      throw errors.badRequest(
        `Payment amount (${formatMoney(b.amount, settings)}) exceeds the outstanding balance of ${formatMoney(outstanding, settings)}.`,
        [{ path: 'amount', message: 'Payment cannot exceed the outstanding balance.' }]
      );
    }

    const payment = await tx.payment.create({
      data: {
        tenantId: req.tenant.id,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: b.amount,
        paymentDate: b.paymentDate || new Date(),
        paymentMethod: b.paymentMethod,
        reference: b.reference || null,
        notes: b.notes || null,
        createdById: req.user.id,
      },
    });

    // Payment → Receipt, automatically, in the same transaction.
    const receiptNumber = await allocateDocumentNumber(tx, req.tenant.id, 'RECEIPT', settings);
    const receipt = await tx.receipt.create({
      data: {
        tenantId: req.tenant.id,
        paymentId: payment.id,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        receiptNumber,
        receiptDate: payment.paymentDate,
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        description: `Payment received for invoice ${invoice.invoiceNumber}`,
        notes: payment.notes,
        createdById: req.user.id,
      },
    });

    // Recompute paid/balance/status from ALL payments — never from client data.
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
      include: { customer: true, items: true },
    });

    return { payment, receipt, invoice: updated };
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'RECORD_PAYMENT', 'payment', {
    entityId: result.payment.id,
    entityLabel: result.invoice.invoiceNumber,
    description: `${req.user.name} recorded payment of ${formatMoney(result.payment.amount, settings)} on ${result.invoice.invoiceNumber}`,
  });
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_RECEIPT', 'receipt', {
    entityId: result.receipt.id,
    entityLabel: result.receipt.receiptNumber,
    description: `${req.user.name} generated receipt ${result.receipt.receiptNumber}`,
  });

  await notifyTenantAdmins({
    tenantId: req.tenant.id,
    excludeUserId: req.user.id,
    type: 'PAYMENT_RECEIVED',
    title: `Payment received — ${formatMoney(result.payment.amount, settings)}`,
    body: `${result.invoice.customer?.name || 'A customer'} paid ${formatMoney(result.payment.amount, settings)} on invoice ${result.invoice.invoiceNumber}.`,
    link: `/invoices/${result.invoice.id}`,
  });

  created(res, {
    payment: { ...result.payment, amount: Number(result.payment.amount) },
    receipt: { ...result.receipt, amount: Number(result.receipt.amount) },
    invoice: serialize(result.invoice),
  });
});

/* ── GET /api/invoices/:id/payments ───────────────────────────────── */

export const listInvoicePayments = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, select: { id: true } });
  if (!invoice) throw errors.notFound('Invoice not found.');

  const payments = await prisma.payment.findMany({
    where: { tenantId: req.tenant.id, invoiceId: invoice.id },
    orderBy: { paymentDate: 'desc' },
    include: { createdBy: { select: { id: true, name: true } }, receipt: { select: { id: true, receiptNumber: true } } },
  });
  ok(res, payments.map((p) => ({ ...p, amount: Number(p.amount) })));
});

/* ── PDF / Email / WhatsApp ───────────────────────────────────────── */

export const invoicePdf = asyncHandler(async (req, res) => {
  await syncInvoiceStatuses(req.tenant.id);
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true, customer: true },
  });
  if (!invoice) throw errors.notFound('Invoice not found.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({ kind: 'INVOICE', document: invoice, customer: invoice.customer, settings, items: invoice.items });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}.pdf"`);
  res.send(buffer);
});

export const invoiceEmail = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true, customer: true },
  });
  if (!invoice) throw errors.notFound('Invoice not found.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({ kind: 'INVOICE', document: invoice, customer: invoice.customer, settings, items: invoice.items });
  const to = req.body?.to || invoice.customer?.email;

  await emailDocument({
    to,
    subject: req.body?.subject || `Invoice ${invoice.invoiceNumber} from ${settings.businessName || req.tenant.name}`,
    message: req.body?.message || `Hello,\n\nPlease find your invoice ${invoice.invoiceNumber}.\nAmount due: ${formatMoney(invoice.balanceDue, settings)}\n\nThank you.`,
    kind: 'INVOICE',
    pdfBuffer: buffer,
    fileName: `${invoice.invoiceNumber}.pdf`,
    previewUrl: previewUrlFor({ kind: 'INVOICE', document: invoice }),
    settings,
  });

  if (['DRAFT', 'UNPAID'].includes(invoice.status)) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });
  }
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'SEND_INVOICE', 'invoice', {
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    description: `${req.user.name} emailed invoice ${invoice.invoiceNumber} to ${to}`,
  });

  ok(res, { message: 'Invoice emailed.' });
});

export const invoiceShare = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true },
  });
  if (!invoice) throw errors.notFound('Invoice not found.');
  const settings = await getSettings(req.tenant.id);
  ok(res, await sharePayload({ kind: 'INVOICE', document: invoice, customer: invoice.customer, settings }));
});

/* ── helpers ──────────────────────────────────────────────────────── */

/**
 * Audit entry for custom line items that were auto-saved to the catalogue,
 * so businesses can see where new Products & services came from.
 */
async function logSavedProducts(req, products) {
  if (!products || products.length === 0) return;
  const list = products.map((p) => p.name).join(', ');
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_PRODUCT', 'product', {
    description: `${req.user.name} auto-saved ${products.length} custom item${products.length > 1 ? 's' : ''} to Products & services: ${list}`,
    metadata: { productIds: products.map((p) => p.id) },
  });
}

function serialize(i) {
  return {
    ...i,
    subtotal: Number(i.subtotal),
    discountAmount: Number(i.discountAmount),
    taxAmount: Number(i.taxAmount),
    total: Number(i.total),
    amountPaid: Number(i.amountPaid),
    balanceDue: Number(i.balanceDue),
    items: i.items?.map((it) => ({ ...it, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), discountValue: Number(it.discountValue), discountAmount: Number(it.discountAmount), taxRate: Number(it.taxRate), taxAmount: Number(it.taxAmount), amount: Number(it.amount) })),
    payments: i.payments?.map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

function endOfDay(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}
