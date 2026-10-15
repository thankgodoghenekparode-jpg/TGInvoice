import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created, parseListQuery, searchFilter } from '../utils/query.js';
import { calculateDocumentTotals } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';
import { saveCustomItemsAsProducts } from '../services/productCatalogService.js';
import { enqueue } from '../services/jobService.js';
import {
  addInterval,
  upcomingRunDates,
  generateInvoiceFromRecurring,
} from '../services/recurringService.js';

/**
 * Recurring invoice templates.
 *
 * The template itself stores no money — totals are recomputed on every
 * generation from the live line items, so editing a price updates all future
 * invoices. Generated invoices are linked back via Invoice.recurringInvoiceId.
 */

const SORTABLE = ['nextRunAt', 'createdAt', 'name', 'status'];
const CUSTOMER_SELECT = { id: true, name: true, companyName: true, email: true, phone: true };

const itemRows = (items) =>
  items.map((it, index) => ({
    productId: it.productId || null,
    description: it.description,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discountType: it.discountType ?? null,
    discountValue: it.discountValue ?? 0,
    taxRate: it.taxRate ?? 0,
    position: index,
  }));

const serialize = (r) => ({
  ...r,
  items: r.items?.map((it) => ({
    ...it,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
    discountValue: Number(it.discountValue),
    taxRate: Number(it.taxRate),
  })),
  estimatedTotal: r.items ? calculateDocumentTotals(r.items).total : undefined,
});

async function assertCustomer(tenantId, customerId) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
  if (!customer) {
    throw errors.badRequest('Select a valid customer.', [{ path: 'customerId', message: 'Customer not found in this business.' }]);
  }
}

/* ── GET /api/recurring-invoices ──────────────────────────────────── */

export const listRecurring = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: 'nextRunAt' });

  const where = {
    tenantId: req.tenant.id,
    ...(req.query.status ? { status: req.query.status } : {}),
    ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
    ...searchFilter(req.query.search, ['name', 'reference', 'customer.name', 'customer.companyName']),
  };

  const [rows, total] = await Promise.all([
    prisma.recurringInvoice.findMany({
      where,
      include: { customer: { select: CUSTOMER_SELECT }, items: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.recurringInvoice.count({ where }),
  ]);

  ok(res, rows.map(serialize), { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

/* ── GET /api/recurring-invoices/:id ──────────────────────────────── */

export const getRecurring = asyncHandler(async (req, res) => {
  const rec = await prisma.recurringInvoice.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: {
      customer: { select: CUSTOMER_SELECT },
      items: true,
      invoices: {
        select: { id: true, invoiceNumber: true, status: true, total: true, invoiceDate: true },
        orderBy: { invoiceDate: 'desc' },
        take: 12,
      },
    },
  });
  if (!rec) throw errors.notFound('Recurring invoice not found.');
  ok(res, { ...serialize(rec), upcoming: upcomingRunDates({ frequency: rec.frequency, interval: rec.interval, from: rec.nextRunAt, count: 5 }) });
});

/* ── POST /api/recurring-invoices ─────────────────────────────────── */

export const createRecurring = asyncHandler(async (req, res) => {
  const b = req.validatedBody;
  await assertCustomer(req.tenant.id, b.customerId);

  const totals = calculateDocumentTotals(b.items);
  const nextRunAt = b.nextRunAt || new Date();

  const { rec, savedProducts } = await prisma.$transaction(async (tx) => {
    const savedProducts = b.saveCustomItems === false ? [] : await saveCustomItemsAsProducts(tx, req.tenant.id, totals.items);
    const created_ = await tx.recurringInvoice.create({
      data: {
        tenantId: req.tenant.id,
        customerId: b.customerId,
        name: b.name,
        frequency: b.frequency,
        interval: b.interval,
        nextRunAt,
        endDate: b.endDate || null,
        dueInDays: b.dueInDays,
        autoSend: b.autoSend,
        autoCharge: b.autoCharge,
        status: b.status,
        reference: b.reference || null,
        notes: b.notes || null,
        terms: b.terms || null,
        createdById: req.user.id,
        items: { create: itemRows(b.items) },
      },
      include: { customer: { select: CUSTOMER_SELECT }, items: true },
    });
    return { rec: created_, savedProducts };
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_RECURRING_INVOICE', 'recurring_invoice', {
    entityId: rec.id,
    entityLabel: rec.name,
    description: `${req.user.name} created recurring invoice "${rec.name}" (${rec.frequency.toLowerCase()} × ${rec.interval})`,
  });

  created(res, serialize(rec));
});

/* ── PUT /api/recurring-invoices/:id ──────────────────────────────── */

export const updateRecurring = asyncHandler(async (req, res) => {
  const existing = await prisma.recurringInvoice.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Recurring invoice not found.');

  const b = req.validatedBody;
  await assertCustomer(req.tenant.id, b.customerId);
  const totals = calculateDocumentTotals(b.items);

  const rec = await prisma.$transaction(async (tx) => {
    await tx.recurringInvoiceItem.deleteMany({ where: { recurringInvoiceId: existing.id } });
    return tx.recurringInvoice.update({
      where: { id: existing.id },
      data: {
        customerId: b.customerId,
        name: b.name,
        frequency: b.frequency,
        interval: b.interval,
        ...(b.nextRunAt ? { nextRunAt: b.nextRunAt } : {}),
        endDate: b.endDate || null,
        dueInDays: b.dueInDays,
        autoSend: b.autoSend,
        autoCharge: b.autoCharge,
        status: b.status,
        reference: b.reference || null,
        notes: b.notes || null,
        terms: b.terms || null,
        items: { create: itemRows(b.items) },
      },
      include: { customer: { select: CUSTOMER_SELECT }, items: true },
    });
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_RECURRING_INVOICE', 'recurring_invoice', {
    entityId: rec.id,
    entityLabel: rec.name,
    description: `${req.user.name} updated recurring invoice "${rec.name}"`,
  });

  ok(res, serialize(rec));
});

/* ── PATCH /api/recurring-invoices/:id/status ─────────────────────── */

export const setRecurringStatus = asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '').toUpperCase();
  if (!['ACTIVE', 'PAUSED', 'COMPLETED'].includes(status)) throw errors.badRequest('Invalid status.');

  const existing = await prisma.recurringInvoice.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Recurring invoice not found.');

  const rec = await prisma.recurringInvoice.update({ where: { id: existing.id }, data: { status } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_RECURRING_INVOICE', 'recurring_invoice', {
    entityId: rec.id,
    entityLabel: rec.name,
    description: `${req.user.name} set recurring invoice "${rec.name}" to ${status.toLowerCase()}`,
  });

  ok(res, serialize(rec));
});

/* ── POST /api/recurring-invoices/:id/run — generate now ──────────── */

export const runRecurringNow = asyncHandler(async (req, res) => {
  const rec = await prisma.recurringInvoice.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!rec) throw errors.notFound('Recurring invoice not found.');
  if (rec.status === 'COMPLETED') throw errors.badRequest('This schedule is already complete.');

  const invoice = await generateInvoiceFromRecurring(rec);
  const nextRunAt = addInterval(rec.nextRunAt, rec.frequency, rec.interval);

  await prisma.recurringInvoice.update({
    where: { id: rec.id },
    data: { lastRunAt: new Date(), nextRunAt, generatedCount: { increment: 1 } },
  });

  if (rec.autoSend) {
    await enqueue('document.autoDeliver', { kind: 'INVOICE', documentId: invoice.id, tenantId: req.tenant.id }).catch(() => {});
  }

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_INVOICE', 'invoice', {
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    description: `${req.user.name} generated ${invoice.invoiceNumber} from recurring invoice "${rec.name}"`,
  });

  created(res, {
    invoice: { ...invoice, total: Number(invoice.total), balanceDue: Number(invoice.balanceDue) },
    nextRunAt,
  });
});

/* ── DELETE /api/recurring-invoices/:id ───────────────────────────── */

export const deleteRecurring = asyncHandler(async (req, res) => {
  const existing = await prisma.recurringInvoice.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Recurring invoice not found.');

  await prisma.recurringInvoice.delete({ where: { id: existing.id } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_RECURRING_INVOICE', 'recurring_invoice', {
    entityId: existing.id,
    entityLabel: existing.name,
    description: `${req.user.name} deleted recurring invoice "${existing.name}"`,
  });

  ok(res, { id: existing.id });
});
