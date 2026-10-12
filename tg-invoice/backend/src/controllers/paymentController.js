import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/errors.js';
import { ok, parseListQuery, searchFilter } from '../utils/query.js';

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
