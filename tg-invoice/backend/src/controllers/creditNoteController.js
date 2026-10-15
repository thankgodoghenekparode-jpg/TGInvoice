import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created, parseListQuery, searchFilter } from '../utils/query.js';
import { calculateDocumentTotals } from '../utils/money.js';
import { allocateDocumentNumber } from '../services/sequenceService.js';
import { logAudit } from '../services/auditService.js';
import { saveCustomItemsAsProducts } from '../services/productCatalogService.js';
import {
  CREDIT_NOTE_INCLUDE,
  serializeCreditNote,
  creditNoteItemRows,
  applyCreditToInvoice,
} from '../services/creditNoteService.js';
import {
  getSettings,
  buildDocumentPdf,
  emailDocument,
  sharePayload,
  previewUrlFor,
  formatMoney,
  CUSTOMER_SELECT,
} from '../services/documentService.js';

const SORTABLE = ['creditNoteNumber', 'creditNoteDate', 'total', 'status', 'createdAt'];

/**
 * Credit notes — a negative document that credits a customer, optionally
 * against an invoice. Applying a credit note settles the invoice's balance
 * through a CREDIT_NOTE-method payment (see services/creditNoteService.js).
 */

/* ── helpers ──────────────────────────────────────────────────────── */

async function assertCustomer(tenantId, customerId) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
  if (!customer) {
    throw errors.badRequest('Select a valid customer.', [{ path: 'customerId', message: 'Customer not found in this business.' }]);
  }
}

async function assertInvoice(tenantId, invoiceId, customerId) {
  if (!invoiceId) return null;
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, customerId: true, invoiceNumber: true },
  });
  if (!invoice) {
    throw errors.badRequest('Select a valid invoice.', [{ path: 'invoiceId', message: 'Invoice not found in this business.' }]);
  }
  if (invoice.customerId !== customerId) {
    throw errors.badRequest('The invoice must belong to the same customer.', [
      { path: 'invoiceId', message: 'Invoice belongs to a different customer.' },
    ]);
  }
  return invoice;
}

/* ── GET /api/credit-notes ────────────────────────────────────────── */

export const listCreditNotes = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-createdAt' });

  const where = {
    tenantId: req.tenant.id,
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
    ...(req.query.from || req.query.to
      ? {
          creditNoteDate: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: endOfDay(req.query.to) } : {}),
          },
        }
      : {}),
    ...searchFilter(req.query.search, ['creditNoteNumber', 'reason', 'customer.name', 'customer.companyName']),
  };

  const [rows, total] = await Promise.all([
    prisma.creditNote.findMany({
      where,
      include: { customer: { select: { id: true, name: true, companyName: true } } },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.creditNote.count({ where }),
  ]);

  ok(res, rows.map(serializeCreditNote), {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

/* ── GET /api/credit-notes/:id ────────────────────────────────────── */

export const getCreditNote = asyncHandler(async (req, res) => {
  const creditNote = await prisma.creditNote.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { ...CREDIT_NOTE_INCLUDE, customer: { select: { ...CUSTOMER_SELECT } } },
  });
  if (!creditNote) throw errors.notFound('Credit note not found.');
  ok(res, serializeCreditNote(creditNote));
});

/* ── POST /api/credit-notes ───────────────────────────────────────── */

export const createCreditNote = asyncHandler(async (req, res) => {
  const b = req.validatedBody;
  const settings = await getSettings(req.tenant.id);
  await assertCustomer(req.tenant.id, b.customerId);
  await assertInvoice(req.tenant.id, b.invoiceId, b.customerId);

  const totals = calculateDocumentTotals(b.items);

  const creditNote = await prisma.$transaction(async (tx) => {
    if (b.saveCustomItems !== false) await saveCustomItemsAsProducts(tx, req.tenant.id, totals.items);
    const creditNoteNumber = await allocateDocumentNumber(tx, req.tenant.id, 'CREDIT_NOTE', settings);
    return tx.creditNote.create({
      data: {
        tenantId: req.tenant.id,
        customerId: b.customerId,
        invoiceId: b.invoiceId || null,
        creditNoteNumber,
        creditNoteDate: b.creditNoteDate || new Date(),
        status: 'DRAFT',
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        amountApplied: 0,
        reason: b.reason || null,
        notes: b.notes || null,
        createdById: req.user.id,
        items: { create: creditNoteItemRows(totals.items) },
      },
      include: CREDIT_NOTE_INCLUDE,
    });
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_CREDIT_NOTE', 'creditNote', {
    entityId: creditNote.id,
    entityLabel: creditNote.creditNoteNumber,
    description: `${req.user.name} created credit note ${creditNote.creditNoteNumber}`,
  });

  created(res, serializeCreditNote(creditNote));
});

/* ── PUT /api/credit-notes/:id (draft only) ───────────────────────── */

export const updateCreditNote = asyncHandler(async (req, res) => {
  const existing = await prisma.creditNote.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { items: true },
  });
  if (!existing) throw errors.notFound('Credit note not found.');
  if (existing.status !== 'DRAFT') {
    throw errors.badRequest('Only draft credit notes can be edited. Void this one and create a new one instead.');
  }

  const b = req.validatedBody;
  await assertCustomer(req.tenant.id, b.customerId);
  await assertInvoice(req.tenant.id, b.invoiceId, b.customerId);
  const totals = calculateDocumentTotals(b.items);

  const creditNote = await prisma.$transaction(async (tx) => {
    if (b.saveCustomItems !== false) await saveCustomItemsAsProducts(tx, req.tenant.id, totals.items);
    await tx.creditNoteItem.deleteMany({ where: { creditNoteId: existing.id } });
    return tx.creditNote.update({
      where: { id: existing.id },
      data: {
        customerId: b.customerId,
        invoiceId: b.invoiceId || null,
        creditNoteDate: b.creditNoteDate || existing.creditNoteDate,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        reason: b.reason || null,
        notes: b.notes || null,
        items: { create: creditNoteItemRows(totals.items) },
      },
      include: CREDIT_NOTE_INCLUDE,
    });
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_CREDIT_NOTE', 'creditNote', {
    entityId: creditNote.id,
    entityLabel: creditNote.creditNoteNumber,
    description: `${req.user.name} edited credit note ${creditNote.creditNoteNumber}`,
  });

  ok(res, serializeCreditNote(creditNote));
});

/* ── DELETE /api/credit-notes/:id (draft only, OWNER/ADMIN) ───────── */

export const deleteCreditNote = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can delete credit notes.');

  const existing = await prisma.creditNote.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Credit note not found.');
  if (existing.status !== 'DRAFT') {
    throw errors.badRequest('Only draft credit notes can be deleted — void it instead so its number is preserved.');
  }

  await prisma.creditNote.delete({ where: { id: existing.id } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_CREDIT_NOTE', 'creditNote', {
    entityId: existing.id,
    entityLabel: existing.creditNoteNumber,
    description: `${req.user.name} deleted draft credit note ${existing.creditNoteNumber}`,
  });

  ok(res, { message: 'Credit note deleted.' });
});

/* ── POST /api/credit-notes/:id/issue ─────────────────────────────── */

export const issueCreditNote = asyncHandler(async (req, res) => {
  const existing = await prisma.creditNote.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Credit note not found.');
  if (existing.status !== 'DRAFT') throw errors.badRequest('Only a draft credit note can be issued.');

  const creditNote = await prisma.creditNote.update({
    where: { id: existing.id },
    data: { status: 'ISSUED' },
    include: CREDIT_NOTE_INCLUDE,
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'ISSUE_CREDIT_NOTE', 'creditNote', {
    entityId: creditNote.id,
    entityLabel: creditNote.creditNoteNumber,
    description: `${req.user.name} issued credit note ${creditNote.creditNoteNumber}`,
  });

  ok(res, serializeCreditNote(creditNote));
});

/* ── POST /api/credit-notes/:id/void (OWNER/ADMIN) ────────────────── */

export const voidCreditNote = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can void credit notes.');

  const existing = await prisma.creditNote.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Credit note not found.');
  if (existing.status === 'VOID') throw errors.badRequest('This credit note is already void.');
  if (Number(existing.amountApplied) > 0) {
    throw errors.badRequest('Credit has already been applied from this note — reverse the application first.');
  }

  const reason = String(req.body?.reason || '').slice(0, 500);
  const creditNote = await prisma.creditNote.update({
    where: { id: existing.id },
    data: { status: 'VOID' },
    include: CREDIT_NOTE_INCLUDE,
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'VOID_CREDIT_NOTE', 'creditNote', {
    entityId: creditNote.id,
    entityLabel: creditNote.creditNoteNumber,
    description: `${req.user.name} voided credit note ${creditNote.creditNoteNumber}${reason ? ` — ${reason}` : ''}`,
  });

  ok(res, serializeCreditNote(creditNote));
});

/* ── POST /api/credit-notes/:id/apply ─────────────────────────────── */

export const applyCreditNote = asyncHandler(async (req, res) => {
  const b = req.validatedBody || {};
  const existing = await prisma.creditNote.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Credit note not found.');

  const targetInvoiceId = b.invoiceId || existing.invoiceId;
  if (!targetInvoiceId) throw errors.badRequest('Select the invoice to apply this credit note to.');

  const settings = await getSettings(req.tenant.id);

  const result = await prisma.$transaction(async (tx) => {
    const creditNote = await tx.creditNote.findFirst({ where: { id: existing.id, tenantId: req.tenant.id } });
    const applied = await applyCreditToInvoice(tx, {
      tenantId: req.tenant.id,
      creditNote,
      invoiceId: targetInvoiceId,
      amount: b.amount,
      userId: req.user.id,
    });
    return applied;
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'APPLY_CREDIT_NOTE', 'creditNote', {
    entityId: result.creditNote.id,
    entityLabel: result.creditNote.creditNoteNumber,
    description: `${req.user.name} applied ${formatMoney(result.applied, settings)} from credit note ${result.creditNote.creditNoteNumber} to invoice ${result.invoice.invoiceNumber}`,
    metadata: { invoiceId: result.invoice.id, paymentId: result.payment.id, amount: result.applied },
  });

  ok(res, {
    creditNote: serializeCreditNote(result.creditNote),
    invoice: {
      id: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      status: result.invoice.status,
      total: Number(result.invoice.total),
      amountPaid: Number(result.invoice.amountPaid),
      balanceDue: Number(result.invoice.balanceDue),
    },
    applied: Number(result.applied),
  });
});

/* ── PDF / Email / Share ──────────────────────────────────────────── */

export const creditNotePdf = asyncHandler(async (req, res) => {
  const creditNote = await prisma.creditNote.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true, items: true, invoice: { select: { id: true, invoiceNumber: true } } },
  });
  if (!creditNote) throw errors.notFound('Credit note not found.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({
    kind: 'CREDIT_NOTE',
    document: creditNote,
    customer: creditNote.customer,
    settings,
    items: creditNote.items,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${creditNote.creditNoteNumber}.pdf"`);
  res.send(buffer);
});

export const creditNoteEmail = asyncHandler(async (req, res) => {
  const creditNote = await prisma.creditNote.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true, items: true, invoice: { select: { id: true, invoiceNumber: true } } },
  });
  if (!creditNote) throw errors.notFound('Credit note not found.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({
    kind: 'CREDIT_NOTE',
    document: creditNote,
    customer: creditNote.customer,
    settings,
    items: creditNote.items,
  });
  const to = req.body?.to || creditNote.customer?.email;

  await emailDocument({
    to,
    subject: req.body?.subject || `Credit note ${creditNote.creditNoteNumber} from ${settings.businessName || req.tenant.name}`,
    message:
      req.body?.message ||
      `Hello,\n\nPlease find credit note ${creditNote.creditNoteNumber}.\nAmount: ${formatMoney(creditNote.total, settings)}\n\nThank you.`,
    kind: 'CREDIT_NOTE',
    pdfBuffer: buffer,
    fileName: `${creditNote.creditNoteNumber}.pdf`,
    previewUrl: previewUrlFor({ kind: 'CREDIT_NOTE', document: creditNote }),
    settings,
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'SEND_CREDIT_NOTE', 'creditNote', {
    entityId: creditNote.id,
    entityLabel: creditNote.creditNoteNumber,
    description: `${req.user.name} emailed credit note ${creditNote.creditNoteNumber} to ${to}`,
  });

  ok(res, { message: 'Credit note emailed.' });
});

export const creditNoteShare = asyncHandler(async (req, res) => {
  const creditNote = await prisma.creditNote.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true },
  });
  if (!creditNote) throw errors.notFound('Credit note not found.');
  if (creditNote.status === 'VOID') throw errors.badRequest('This credit note has been voided and cannot be shared.');
  const settings = await getSettings(req.tenant.id);
  ok(res, await sharePayload({ kind: 'CREDIT_NOTE', document: creditNote, customer: creditNote.customer, settings }));
});

/* ── helpers ──────────────────────────────────────────────────────── */

function endOfDay(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}
