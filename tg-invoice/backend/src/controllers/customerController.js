import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created, paged, parseListQuery, searchFilter } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { allocateDocumentNumber } from '../services/sequenceService.js';
import { getPublicUrl } from '../services/storageService.js';

const SORTABLE = ['name', 'companyName', 'createdAt', 'updatedAt', 'customerCode'];

/** Invoice aggregates per customer, already restricted to this tenant. */
async function invoiceStats(tenantId) {
  const rows = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: { tenantId, status: { notIn: ['CANCELLED', 'VOID'] } },
    _count: { _all: true },
    _sum: { total: true, amountPaid: true, balanceDue: true },
  });
  const map = new Map();
  for (const r of rows) {
    map.set(r.customerId, {
      invoiceCount: r._count._all,
      totalInvoiced: Number(r._sum.total ?? 0),
      totalPaid: Number(r._sum.amountPaid ?? 0),
      outstanding: Number(r._sum.balanceDue ?? 0),
    });
  }
  return map;
}

/* ── GET /api/customers ───────────────────────────────────────────── */

export const listCustomers = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-createdAt' });
  const where = {
    tenantId: req.tenant.id, // ← always the server-determined tenant
    ...searchFilter(req.query.search, ['name', 'companyName', 'email', 'phone', 'customerCode']),
  };

  const [rows, total, stats] = await Promise.all([
    prisma.customer.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.customer.count({ where }),
    invoiceStats(req.tenant.id),
  ]);

  const data = rows.map((c) => ({ ...c, ...(stats.get(c.id) || { invoiceCount: 0, totalInvoiced: 0, totalPaid: 0, outstanding: 0 }) }));
  ok(res, data, { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

/* ── GET /api/customers/:id ───────────────────────────────────────── */

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id }, // tenant-scoped find — 404 for other tenants' rows
  });
  if (!customer) throw errors.notFound('Customer not found.');

  const [stats, quotationAgg] = await Promise.all([
    invoiceStats(req.tenant.id),
    prisma.quotation.groupBy({
      by: ['status'],
      where: { tenantId: req.tenant.id, customerId: customer.id },
      _count: { _all: true },
      _sum: { total: true },
    }),
  ]);

  ok(res, {
    ...customer,
    ...(stats.get(customer.id) || { invoiceCount: 0, totalInvoiced: 0, totalPaid: 0, outstanding: 0 }),
    quotationCount: quotationAgg.reduce((n, r) => n + r._count._all, 0),
    totalQuoted: quotationAgg.reduce((n, r) => n + Number(r._sum.total ?? 0), 0),
  });
});

/* ── POST /api/customers ──────────────────────────────────────────── */

export const createCustomer = asyncHandler(async (req, res) => {
  const b = req.body;

  // Tenant-specific customer code: CUS-00001 — allocated safely in sequence.
  const code = await allocateDocumentNumber(prisma, req.tenant.id, 'CUSTOMER', null);

  const customer = await prisma.customer.create({
    data: {
      tenantId: req.tenant.id,
      customerCode: code,
      name: b.name,
      companyName: b.companyName || null,
      email: b.email || null,
      phone: b.phone || null,
      address: b.address || null,
      city: b.city || null,
      state: b.state || null,
      country: b.country || null,
      taxId: b.taxId || null,
      notes: b.notes || null,
    },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_CUSTOMER', 'customer', {
    entityId: customer.id,
    entityLabel: customer.name,
    description: `${req.user.name} created customer ${customer.name} (${customer.customerCode})`,
  });

  created(res, customer);
});

/* ── PUT /api/customers/:id ───────────────────────────────────────── */

export const updateCustomer = asyncHandler(async (req, res) => {
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Customer not found.');

  const b = req.body;
  const customer = await prisma.customer.update({
    where: { id: existing.id },
    data: {
      name: b.name,
      companyName: b.companyName || null,
      email: b.email || null,
      phone: b.phone || null,
      address: b.address || null,
      city: b.city || null,
      state: b.state || null,
      country: b.country || null,
      taxId: b.taxId || null,
      notes: b.notes || null,
    },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_CUSTOMER', 'customer', {
    entityId: customer.id,
    entityLabel: customer.name,
    description: `${req.user.name} edited customer ${customer.name}`,
  });

  ok(res, customer);
});

/* ── DELETE /api/customers/:id ────────────────────────────────────── */

export const deleteCustomer = asyncHandler(async (req, res) => {
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Customer not found.');

  const docs = await prisma.invoice.count({ where: { tenantId: req.tenant.id, customerId: existing.id } });
  const quotes = await prisma.quotation.count({ where: { tenantId: req.tenant.id, customerId: existing.id } });
  if (docs > 0 || quotes > 0) {
    throw errors.badRequest('This customer has quotations or invoices and cannot be deleted. Their financial history must be preserved.');
  }

  await prisma.customer.delete({ where: { id: existing.id } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_CUSTOMER', 'customer', {
    entityId: existing.id,
    entityLabel: existing.name,
    description: `${req.user.name} deleted customer ${existing.name}`,
  });

  ok(res, { message: 'Customer deleted.' });
});

export { invoiceStats };
