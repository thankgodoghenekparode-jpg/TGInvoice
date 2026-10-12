import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/query.js';

/**
 * GET /api/search?q=… — global search across the ACTIVE TENANT only.
 * Searches document numbers, customer names, companies, phones, emails and
 * references. There is no path to a cross-tenant result.
 */
export const globalSearch = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return ok(res, { customers: [], quotations: [], invoices: [], receipts: [] });

  const tenantId = req.tenant.id;
  const contains = { contains: q, mode: 'insensitive' };

  const [customers, quotations, invoices, receipts] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId, OR: [{ name: contains }, { companyName: contains }, { email: contains }, { phone: contains }, { customerCode: contains }] },
      take: 5,
      select: { id: true, name: true, companyName: true, customerCode: true, phone: true, email: true },
    }),
    prisma.quotation.findMany({
      where: { tenantId, OR: [{ quotationNumber: contains }, { reference: contains }, { customer: { OR: [{ name: contains }, { companyName: contains }] } }] },
      take: 5,
      select: { id: true, quotationNumber: true, total: true, status: true, quotationDate: true, customer: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { tenantId, OR: [{ invoiceNumber: contains }, { reference: contains }, { customer: { OR: [{ name: contains }, { companyName: contains }, { phone: contains }, { email: contains }] } }] },
      take: 5,
      select: { id: true, invoiceNumber: true, total: true, balanceDue: true, status: true, invoiceDate: true, customer: { select: { name: true } } },
    }),
    prisma.receipt.findMany({
      where: { tenantId, OR: [{ receiptNumber: contains }, { reference: contains }, { customer: { OR: [{ name: contains }, { companyName: contains }] } }] },
      take: 5,
      select: { id: true, receiptNumber: true, amount: true, status: true, receiptDate: true, customer: { select: { name: true } } },
    }),
  ]);

  ok(res, { customers, quotations, invoices, receipts });
});
