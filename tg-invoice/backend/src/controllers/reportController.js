import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/query.js';
import { syncInvoiceStatuses } from './invoiceController.js';

/**
 * Date-range resolution for reports.
 * period = today | week | month | lastMonth | year | custom (from/to)
 */
function resolveRange(query) {
  const now = new Date();
  const startOfDay = (d) => new Date(new Date(d).setHours(0, 0, 0, 0));
  const endOfDay = (d) => new Date(new Date(d).setHours(23, 59, 59, 999));

  switch (query.period) {
    case 'today':
      return { gte: startOfDay(now), lte: endOfDay(now) };
    case 'week': {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      return { gte: startOfDay(monday), lte: endOfDay(now) };
    }
    case 'month':
      return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: endOfDay(now) };
    case 'lastMonth':
      return {
        gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        lte: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      };
    case 'year':
      return { gte: new Date(now.getFullYear(), 0, 1), lte: endOfDay(now) };
    case 'custom':
      if (query.from || query.to) {
        return {
          gte: query.from ? startOfDay(query.from) : new Date(0),
          lte: query.to ? endOfDay(query.to) : endOfDay(now),
        };
      }
      return null;
    default:
      return null; // all time
  }
}

const inRange = (field, range) => (range ? { [field]: range } : {});
const num = (v) => Number(v ?? 0);

/* ── GET /api/reports/dashboard ───────────────────────────────────── */

export const dashboard = asyncHandler(async (req, res) => {
  const tenantId = req.tenant.id;
  await syncInvoiceStatuses(tenantId);

  const invoiceWhere = { tenantId, status: { notIn: ['CANCELLED', 'VOID'] } };

  const [invoiceAgg, paidAgg, counts, quotationCount, receiptCount, refundAgg, recent] = await Promise.all([
    prisma.invoice.aggregate({ where: invoiceWhere, _count: { _all: true }, _sum: { total: true, balanceDue: true } }),
    // Cash received only — a credit note applied to an invoice is a settlement,
    // not money in the bank, so it is excluded here (visible in the payment report).
    prisma.payment.aggregate({ where: { tenantId, paymentMethod: { not: 'CREDIT_NOTE' } }, _sum: { amount: true } }),
    prisma.invoice.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    prisma.quotation.count({ where: { tenantId } }),
    prisma.receipt.count({ where: { tenantId, status: 'ISSUED' } }),
    prisma.refund.aggregate({ where: { tenantId, status: 'COMPLETED' }, _sum: { amount: true } }),
    fetchRecentDocuments(tenantId),
  ]);

  // Monthly series: last 12 months of invoiced vs paid.
  const months = monthlySeries(tenantId);

  const statusMap = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const invoiced = num(invoiceAgg._sum.total);
  const paid = num(paidAgg._sum.amount);

  ok(res, {
    totalInvoices: invoiceAgg._count._all,
    totalInvoiced: invoiced,
    totalPaid: paid,
    totalRefunded: num(refundAgg._sum.amount),
    outstanding: num(invoiceAgg._sum.balanceDue),
    totalQuotations: quotationCount,
    totalReceipts: receiptCount,
    invoiceStatus: {
      paid: statusMap.PAID || 0,
      partiallyPaid: statusMap.PARTIALLY_PAID || 0,
      unpaid: (statusMap.UNPAID || 0) + (statusMap.SENT || 0),
      overdue: statusMap.OVERDUE || 0,
      draft: statusMap.DRAFT || 0,
      cancelled: statusMap.CANCELLED || 0,
    },
    revenue: await months,
    recentDocuments: recent,
  });
});

async function fetchRecentDocuments(tenantId) {
  const [invoices, quotations, receipts] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId },
      take: 6,
      orderBy: { createdAt: 'desc' },
      select: { id: true, invoiceNumber: true, total: true, balanceDue: true, status: true, createdAt: true, customer: { select: { name: true } } },
    }),
    prisma.quotation.findMany({
      where: { tenantId },
      take: 6,
      orderBy: { createdAt: 'desc' },
      select: { id: true, quotationNumber: true, total: true, status: true, createdAt: true, customer: { select: { name: true } } },
    }),
    prisma.receipt.findMany({
      where: { tenantId },
      take: 6,
      orderBy: { createdAt: 'desc' },
      select: { id: true, receiptNumber: true, amount: true, status: true, createdAt: true, customer: { select: { name: true } } },
    }),
  ]);

  return [
    ...invoices.map((i) => ({ id: i.id, type: 'INVOICE', number: i.invoiceNumber, customer: i.customer?.name, amount: num(i.total), balance: num(i.balanceDue), status: i.status, date: i.createdAt })),
    ...quotations.map((q) => ({ id: q.id, type: 'QUOTATION', number: q.quotationNumber, customer: q.customer?.name, amount: num(q.total), status: q.status, date: q.createdAt })),
    ...receipts.map((r) => ({ id: r.id, type: 'RECEIPT', number: r.receiptNumber, customer: r.customer?.name, amount: num(r.amount), status: r.status, date: r.createdAt })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);
}

async function monthlySeries(tenantId) {
  const start = new Date();
  start.setMonth(start.getMonth() - 11);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, invoiceDate: { gte: start }, status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] } },
      select: { invoiceDate: true, total: true },
    }),
    prisma.payment.findMany({ where: { tenantId, paymentDate: { gte: start }, paymentMethod: { not: 'CREDIT_NOTE' } }, select: { paymentDate: true, amount: true } }),
  ]);

  const buckets = [];
  const cursor = new Date(start);
  for (let i = 0; i < 12; i += 1) {
    buckets.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      label: cursor.toLocaleDateString('en-US', { month: 'short' }),
      invoiced: 0,
      paid: 0,
      outstanding: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const bucketFor = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  for (const inv of invoices) {
    const b = buckets.find((x) => x.key === bucketFor(inv.invoiceDate));
    if (b) b.invoiced += num(inv.total);
  }
  for (const p of payments) {
    const b = buckets.find((x) => x.key === bucketFor(p.paymentDate));
    if (b) b.paid += num(p.amount);
  }
  for (const b of buckets) b.outstanding = Math.max(0, b.invoiced - b.paid);

  return buckets.map(({ key, ...rest }) => ({ ...rest, invoiced: round2(rest.invoiced), paid: round2(rest.paid), outstanding: round2(rest.outstanding) }));
}

const round2 = (v) => Math.round(v * 100) / 100;

/* ── GET /api/reports/invoices ────────────────────────────────────── */

export const invoiceReport = asyncHandler(async (req, res) => {
  const tenantId = req.tenant.id;
  await syncInvoiceStatuses(tenantId);
  const range = resolveRange(req.query);

  const where = { tenantId, ...inRange('invoiceDate', range) };
  const [agg, rows, statusCounts] = await Promise.all([
    prisma.invoice.aggregate({
      where: { ...where, status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] } },
      _count: { _all: true },
      _sum: { total: true, amountPaid: true, balanceDue: true },
    }),
    prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
      take: 500,
      select: {
        id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, status: true,
        total: true, amountPaid: true, balanceDue: true,
        customer: { select: { id: true, name: true, companyName: true } },
      },
    }),
    prisma.invoice.groupBy({ by: ['status'], where: { tenantId, ...inRange('invoiceDate', range) }, _count: { _all: true }, _sum: { total: true, balanceDue: true } }),
  ]);

  const overdue = await prisma.invoice.aggregate({
    where: { tenantId, ...inRange('invoiceDate', range), status: 'OVERDUE' },
    _count: { _all: true },
    _sum: { balanceDue: true },
  });

  ok(res, {
    summary: {
      totalInvoices: agg._count._all,
      totalInvoiced: num(agg._sum.total),
      totalPaid: num(agg._sum.amountPaid),
      outstanding: num(agg._sum.balanceDue),
      overdueCount: overdue._count._all,
      overdueAmount: num(overdue._sum.balanceDue),
    },
    byStatus: statusCounts.map((s) => ({ status: s.status, count: s._count._all, total: num(s._sum.total), balance: num(s._sum.balanceDue) })),
    rows: rows.map((r) => ({
      ...r,
      total: num(r.total), amountPaid: num(r.amountPaid), balanceDue: num(r.balanceDue),
      customerName: r.customer?.companyName || r.customer?.name || '',
    })),
  });
});

/* ── GET /api/reports/payments ────────────────────────────────────── */

export const paymentReport = asyncHandler(async (req, res) => {
  const tenantId = req.tenant.id;
  const range = resolveRange(req.query);
  const where = { tenantId, ...inRange('paymentDate', range) };
  const cashWhere = { ...where, paymentMethod: { not: 'CREDIT_NOTE' } };

  const [agg, creditAgg, byMethod, rows] = await Promise.all([
    prisma.payment.aggregate({ where: cashWhere, _count: { _all: true }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { ...where, paymentMethod: 'CREDIT_NOTE' }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['paymentMethod'], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.payment.findMany({
      where,
      orderBy: { paymentDate: 'desc' },
      take: 500,
      include: {
        customer: { select: { name: true, companyName: true } },
        invoice: { select: { invoiceNumber: true } },
        receipt: { select: { receiptNumber: true } },
      },
    }),
  ]);

  ok(res, {
    summary: {
      totalPayments: agg._count._all,
      totalReceived: num(agg._sum.amount),
      totalCreditApplied: num(creditAgg._sum.amount),
    },
    byMethod: byMethod.map((m) => ({ method: m.paymentMethod, count: m._count._all, total: num(m._sum.amount) })),
    rows: rows.map((p) => ({
      id: p.id,
      paymentDate: p.paymentDate,
      amount: num(p.amount),
      paymentMethod: p.paymentMethod,
      reference: p.reference,
      invoiceNumber: p.invoice?.invoiceNumber,
      receiptNumber: p.receipt?.receiptNumber,
      customerName: p.customer?.companyName || p.customer?.name || '',
    })),
  });
});

/* ── GET /api/reports/quotations ──────────────────────────────────── */

export const quotationReport = asyncHandler(async (req, res) => {
  const tenantId = req.tenant.id;
  const range = resolveRange(req.query);
  const where = { tenantId, ...inRange('quotationDate', range) };

  const [agg, statusCounts, rows] = await Promise.all([
    prisma.quotation.aggregate({ where, _count: { _all: true }, _sum: { total: true } }),
    prisma.quotation.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { total: true } }),
    prisma.quotation.findMany({
      where,
      orderBy: { quotationDate: 'desc' },
      take: 500,
      select: {
        id: true, quotationNumber: true, quotationDate: true, status: true, total: true,
        customer: { select: { name: true, companyName: true } },
      },
    }),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s.status, { count: s._count._all, total: num(s._sum.total) }]));

  ok(res, {
    summary: {
      totalQuotations: agg._count._all,
      totalQuotedValue: num(agg._sum.total),
      accepted: byStatus.ACCEPTED?.count || 0,
      rejected: byStatus.REJECTED?.count || 0,
      pending: (byStatus.DRAFT?.count || 0) + (byStatus.SENT?.count || 0),
      expired: byStatus.EXPIRED?.count || 0,
      converted: byStatus.CONVERTED?.count || 0,
    },
    byStatus: statusCounts.map((s) => ({ status: s.status, count: s._count._all, total: num(s._sum.total) })),
    rows: rows.map((q) => ({
      ...q,
      total: num(q.total),
      customerName: q.customer?.companyName || q.customer?.name || '',
    })),
  });
});

/* ── GET /api/reports/customers ───────────────────────────────────── */

export const customerReport = asyncHandler(async (req, res) => {
  const tenantId = req.tenant.id;
  const range = resolveRange(req.query);

  const customers = await prisma.customer.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
    select: { id: true, customerCode: true, name: true, companyName: true },
  });

  const grouped = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: { tenantId, ...inRange('invoiceDate', range), status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] } },
    _count: { _all: true },
    _sum: { total: true, amountPaid: true, balanceDue: true },
  });
  const map = new Map(grouped.map((g) => [g.customerId, g]));

  const rows = customers
    .map((c) => {
      const g = map.get(c.id);
      return {
        customerId: c.id,
        customerCode: c.customerCode,
        customerName: c.companyName || c.name,
        invoiceCount: g?._count._all || 0,
        totalInvoiced: num(g?._sum.total),
        totalPaid: num(g?._sum.amountPaid),
        outstanding: num(g?._sum.balanceDue),
      };
    })
    .filter((r) => r.invoiceCount > 0 || !range) // with a range, only customers who have invoices
    .sort((a, b) => b.totalInvoiced - a.totalInvoiced);

  const totals = rows.reduce(
    (acc, r) => ({
      totalInvoiced: acc.totalInvoiced + r.totalInvoiced,
      totalPaid: acc.totalPaid + r.totalPaid,
      outstanding: acc.outstanding + r.outstanding,
    }),
    { totalInvoiced: 0, totalPaid: 0, outstanding: 0 }
  );

  ok(res, { rows, summary: { totalCustomers: rows.length, ...totals } });
});

export { resolveRange };
