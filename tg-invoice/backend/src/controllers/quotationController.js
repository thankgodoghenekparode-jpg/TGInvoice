import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created, parseListQuery, searchFilter } from '../utils/query.js';
import { calculateDocumentTotals } from '../utils/money.js';
import { allocateDocumentNumber } from '../services/sequenceService.js';
import { logAudit } from '../services/auditService.js';
import { saveCustomItemsAsProducts } from '../services/productCatalogService.js';
import { enqueue } from '../services/jobService.js';
import {
  getSettings,
  buildDocumentPdf,
  emailDocument,
  sharePayload,
  previewUrlFor,
  formatMoney,
  CUSTOMER_SELECT,
} from '../services/documentService.js';

const SORTABLE = ['quotationNumber', 'quotationDate', 'total', 'status', 'createdAt', 'updatedAt'];
const CUSTOMER_FILTER = { id: true, name: true, companyName: true, phone: true, email: true };

const include = { customer: { select: CUSTOMER_FILTER }, createdBy: { select: { id: true, name: true } }, items: true };

/** Verify referenced customer/products exist INSIDE this tenant. */
async function assertTenantReferences(tenantId, { customerId, items }) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
  if (!customer) throw errors.badRequest('Select a valid customer.', [{ path: 'customerId', message: 'Customer not found in this business.' }]);

  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length) {
    const count = await prisma.product.count({ where: { id: { in: productIds }, tenantId } });
    if (count !== productIds.length) {
      throw errors.badRequest('One or more items reference a product that does not exist in this business.');
    }
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

/* ── GET /api/quotations ──────────────────────────────────────────── */

export const listQuotations = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-quotationDate' });

  const where = {
    tenantId: req.tenant.id,
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
    ...(req.query.from || req.query.to
      ? {
          quotationDate: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: endOfDay(req.query.to) } : {}),
          },
        }
      : {}),
    ...searchFilter(req.query.search, ['quotationNumber', 'reference', 'customer.name', 'customer.companyName']),
  };

  const [rows, total] = await Promise.all([
    prisma.quotation.findMany({
      where,
      include,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.quotation.count({ where }),
  ]);

  ok(res, serializeMany(rows), { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

/* ── GET /api/quotations/:id ──────────────────────────────────────── */

export const getQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id }, // tenant-scoped: 404 across tenants
    include: { ...include, customer: { select: { ...CUSTOMER_SELECT } } },
  });
  if (!quotation) throw errors.notFound('Quotation not found.');
  ok(res, serialize(quotation));
});

/* ── POST /api/quotations ─────────────────────────────────────────── */

export const createQuotation = asyncHandler(async (req, res) => {
  const b = req.validatedBody;
  const settings = await getSettings(req.tenant.id);
  await assertTenantReferences(req.tenant.id, b);

  // Backend is the source of truth for every number on the document.
  const totals = calculateDocumentTotals(b.items);

  const { quotation, savedProducts } = await prisma.$transaction(async (tx) => {
    const savedProducts = b.saveCustomItems === false ? [] : await saveCustomItemsAsProducts(tx, req.tenant.id, totals.items);
    const quotationNumber = await allocateDocumentNumber(tx, req.tenant.id, 'QUOTATION', settings);
    const quotation = await tx.quotation.create({
      data: {
        tenantId: req.tenant.id,
        customerId: b.customerId,
        quotationNumber,
        quotationDate: b.quotationDate,
        validUntil: b.validUntil || null,
        reference: b.reference || null,
        status: b.status || 'DRAFT',
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        notes: b.notes || null,
        terms: b.terms || settings.defaultQuotationTerms || null,
        createdById: req.user.id,
        items: { create: lineRows(totals.items) },
      },
      include,
    });
    return { quotation, savedProducts };
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_QUOTATION', 'quotation', {
    entityId: quotation.id,
    entityLabel: quotation.quotationNumber,
    description: `${req.user.name} created quotation ${quotation.quotationNumber}`,
  });
  await logSavedProducts(req, savedProducts);

  created(res, serialize(quotation));
});

/* ── PUT /api/quotations/:id ──────────────────────────────────────── */

export const updateQuotation = asyncHandler(async (req, res) => {
  const existing = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true },
  });
  if (!existing) throw errors.notFound('Quotation not found.');
  if (existing.status === 'CONVERTED') {
    throw errors.badRequest('This quotation has already been converted to an invoice and can no longer be edited.');
  }

  const b = req.validatedBody;
  await assertTenantReferences(req.tenant.id, b);
  const totals = calculateDocumentTotals(b.items);

  const { quotation, savedProducts } = await prisma.$transaction(async (tx) => {
    const savedProducts = b.saveCustomItems === false ? [] : await saveCustomItemsAsProducts(tx, req.tenant.id, totals.items);
    await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
    const quotation = await tx.quotation.update({
      where: { id: existing.id },
      data: {
        customerId: b.customerId,
        quotationDate: b.quotationDate,
        validUntil: b.validUntil || null,
        reference: b.reference || null,
        status: b.status || 'DRAFT',
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        notes: b.notes || null,
        terms: b.terms || existing.terms || null,
        items: { create: lineRows(totals.items) },
      },
      include,
    });
    return { quotation, savedProducts };
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_QUOTATION', 'quotation', {
    entityId: quotation.id,
    entityLabel: quotation.quotationNumber,
    description: `${req.user.name} edited quotation ${quotation.quotationNumber}`,
  });
  await logSavedProducts(req, savedProducts);

  ok(res, serialize(quotation));
});

/* ── DELETE /api/quotations/:id (OWNER/ADMIN) ─────────────────────── */

export const deleteQuotation = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can delete quotations.');

  const existing = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { invoices: { select: { id: true, invoiceNumber: true } } },
  });
  if (!existing) throw errors.notFound('Quotation not found.');
  if (existing.invoices.length > 0 || existing.status === 'CONVERTED') {
    throw errors.badRequest('This quotation was converted to an invoice and cannot be deleted — the invoice must keep its reference.');
  }

  await prisma.quotation.delete({ where: { id: existing.id } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_QUOTATION', 'quotation', {
    entityId: existing.id,
    entityLabel: existing.quotationNumber,
    description: `${req.user.name} deleted quotation ${existing.quotationNumber}`,
  });

  ok(res, { message: 'Quotation deleted.' });
});

/* ── POST /api/quotations/:id/duplicate ───────────────────────────── */

export const duplicateQuotation = asyncHandler(async (req, res) => {
  const source = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true },
  });
  if (!source) throw errors.notFound('Quotation not found.');
  const settings = await getSettings(req.tenant.id);

  const copy = await prisma.$transaction(async (tx) => {
    const quotationNumber = await allocateDocumentNumber(tx, req.tenant.id, 'QUOTATION', settings);
    return tx.quotation.create({
      data: {
        tenantId: req.tenant.id,
        customerId: source.customerId,
        quotationNumber,
        quotationDate: new Date(),
        validUntil: source.validUntil,
        reference: source.reference,
        status: 'DRAFT',
        subtotal: source.subtotal,
        discountAmount: source.discountAmount,
        taxAmount: source.taxAmount,
        total: source.total,
        notes: source.notes,
        terms: source.terms,
        createdById: req.user.id,
        items: {
          create: source.items.map((it) => ({
            productId: it.productId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discountType: it.discountType,
            discountValue: it.discountValue,
            discountAmount: it.discountAmount,
            taxRate: it.taxRate,
            taxAmount: it.taxAmount,
            amount: it.amount,
            position: it.position,
          })),
        },
      },
      include,
    });
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_QUOTATION', 'quotation', {
    entityId: copy.id,
    entityLabel: copy.quotationNumber,
    description: `${req.user.name} duplicated ${source.quotationNumber} as ${copy.quotationNumber}`,
  });

  created(res, serialize(copy));
});

/* ── POST /api/quotations/:id/convert → invoice ───────────────────── */

export const convertQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true, customer: true },
  });
  if (!quotation) throw errors.notFound('Quotation not found.');
  if (quotation.status === 'CONVERTED') throw errors.badRequest('This quotation has already been converted to an invoice.');

  const settings = await getSettings(req.tenant.id);
  const dueDate = req.body?.dueDate
    ? new Date(req.body.dueDate)
    : new Date(new Date(quotation.quotationDate).getTime() + 30 * 24 * 60 * 60 * 1000);

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await allocateDocumentNumber(tx, req.tenant.id, 'INVOICE', settings);

    const inv = await tx.invoice.create({
      data: {
        tenantId: req.tenant.id,
        customerId: quotation.customerId,
        quotationId: quotation.id, // ← link back to the source quotation
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate,
        reference: quotation.reference,
        status: 'UNPAID',
        // Customer, items, quantities, prices, discounts, taxes, notes and
        // terms are all preserved — the original quotation is NOT modified
        // beyond its status.
        subtotal: quotation.subtotal,
        discountAmount: quotation.discountAmount,
        taxAmount: quotation.taxAmount,
        total: quotation.total,
        amountPaid: 0,
        balanceDue: quotation.total,
        notes: quotation.notes,
        terms: quotation.terms,
        createdById: req.user.id,
        items: {
          create: quotation.items.map((it) => ({
            productId: it.productId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discountType: it.discountType,
            discountValue: it.discountValue,
            discountAmount: it.discountAmount,
            taxRate: it.taxRate,
            taxAmount: it.taxAmount,
            amount: it.amount,
            position: it.position,
          })),
        },
      },
      include: { customer: true, items: true },
    });

    await tx.quotation.update({ where: { id: quotation.id }, data: { status: 'CONVERTED' } });
    return inv;
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CONVERT_QUOTATION', 'quotation', {
    entityId: quotation.id,
    entityLabel: quotation.quotationNumber,
    description: `${req.user.name} converted ${quotation.quotationNumber} to ${invoice.invoiceNumber}`,
  });
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_INVOICE', 'invoice', {
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    description: `${req.user.name} created invoice ${invoice.invoiceNumber} from ${quotation.quotationNumber}`,
  });

  created(res, { invoice: serializeInvoice(invoice), quotation: { id: quotation.id, quotationNumber: quotation.quotationNumber, status: 'CONVERTED' } });
});

/* ── Status transitions (non-financial only) ──────────────────────── */

export const updateQuotationStatus = asyncHandler(async (req, res) => {
  const allowed = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) throw errors.badRequest('Invalid quotation status.');

  const existing = await prisma.quotation.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Quotation not found.');
  if (existing.status === 'CONVERTED') throw errors.badRequest('Converted quotations cannot change status.');

  const quotation = await prisma.quotation.update({ where: { id: existing.id }, data: { status } });

  // Marking a quotation SENT may trigger the tenant's automatic delivery.
  if (status === 'SENT' && existing.status !== 'SENT') {
    await enqueue('document.autoDeliver', { kind: 'QUOTATION', documentId: quotation.id, tenantId: req.tenant.id }).catch(() => {});
  }

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_QUOTATION', 'quotation', {
    entityId: quotation.id,
    entityLabel: quotation.quotationNumber,
    description: `${req.user.name} marked ${quotation.quotationNumber} as ${status}`,
  });

  ok(res, serialize(quotation));
});

/* ── PDF / Email / WhatsApp ───────────────────────────────────────── */

export const quotationPdf = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true, customer: true },
  });
  if (!quotation) throw errors.notFound('Quotation not found.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({ kind: 'QUOTATION', document: quotation, customer: quotation.customer, settings, items: quotation.items });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${quotation.quotationNumber}.pdf"`);
  res.send(buffer);
});

export const quotationEmail = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true, customer: true },
  });
  if (!quotation) throw errors.notFound('Quotation not found.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({ kind: 'QUOTATION', document: quotation, customer: quotation.customer, settings, items: quotation.items });
  const to = req.body?.to || quotation.customer?.email;

  await emailDocument({
    to,
    subject: req.body?.subject || `Quotation ${quotation.quotationNumber} from ${settings.businessName || req.tenant.name}`,
    message: req.body?.message || defaultBody('Quotation', quotation.quotationNumber, quotation.total, settings),
    kind: 'QUOTATION',
    pdfBuffer: buffer,
    fileName: `${quotation.quotationNumber}.pdf`,
    previewUrl: previewUrlFor({ kind: 'QUOTATION', document: quotation }),
    settings,
  });

  if (quotation.status === 'DRAFT') {
    await prisma.quotation.update({ where: { id: quotation.id }, data: { status: 'SENT' } });
  }
  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'SEND_QUOTATION', 'quotation', {
    entityId: quotation.id,
    entityLabel: quotation.quotationNumber,
    description: `${req.user.name} emailed quotation ${quotation.quotationNumber} to ${to}`,
  });

  ok(res, { message: 'Quotation emailed.' });
});

export const quotationShare = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true },
  });
  if (!quotation) throw errors.notFound('Quotation not found.');
  const settings = await getSettings(req.tenant.id);
  ok(res, await sharePayload({ kind: 'QUOTATION', document: quotation, customer: quotation.customer, settings }));
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

function serialize(q) {
  return { ...q, subtotal: Number(q.subtotal), discountAmount: Number(q.discountAmount), taxAmount: Number(q.taxAmount), total: Number(q.total) };
}
function serializeMany(rows) {
  return rows.map((q) => ({ ...q, subtotal: Number(q.subtotal), discountAmount: Number(q.discountAmount), taxAmount: Number(q.taxAmount), total: Number(q.total), items: undefined }));
}
function serializeInvoice(i) {
  return { ...i, subtotal: Number(i.subtotal), discountAmount: Number(i.discountAmount), taxAmount: Number(i.taxAmount), total: Number(i.total), amountPaid: Number(i.amountPaid), balanceDue: Number(i.balanceDue), items: undefined };
}
function endOfDay(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}
function defaultBody(label, number, total, settings) {
  return `Hello,\n\nPlease find your ${label} ${number}.\nAmount: ${formatMoney(total, settings)}\n\nThank you for your business.`;
}
