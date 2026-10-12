import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, parseListQuery, searchFilter } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { getSettings, buildDocumentPdf, emailDocument, sharePayload, previewUrlFor, formatMoney } from '../services/documentService.js';

const SORTABLE = ['receiptNumber', 'receiptDate', 'amount', 'createdAt', 'status'];
const INCLUDE = {
  customer: { select: { id: true, name: true, companyName: true, phone: true, email: true } },
  invoice: { select: { id: true, invoiceNumber: true, total: true } },
  payment: { select: { id: true, paymentDate: true, reference: true } },
  createdBy: { select: { id: true, name: true } },
};

const serialize = (r) => ({ ...r, amount: Number(r.amount) });

/* ── GET /api/receipts ────────────────────────────────────────────── */

export const listReceipts = asyncHandler(async (req, res) => {
  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-receiptDate' });

  const where = {
    tenantId: req.tenant.id,
    ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
    ...(req.query.from || req.query.to
      ? {
          receiptDate: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: endOfDay(req.query.to) } : {}),
          },
        }
      : {}),
    ...searchFilter(req.query.search, ['receiptNumber', 'reference', 'invoice.invoiceNumber', 'customer.name', 'customer.companyName']),
  };

  const [rows, total] = await Promise.all([
    prisma.receipt.findMany({ where, include: INCLUDE, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.receipt.count({ where }),
  ]);

  ok(res, rows.map(serialize), { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

/* ── GET /api/receipts/:id ────────────────────────────────────────── */

export const getReceipt = asyncHandler(async (req, res) => {
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id }, // tenant-scoped
    include: {
      ...INCLUDE,
      invoice: { select: { id: true, invoiceNumber: true, total: true, amountPaid: true, balanceDue: true, status: true } },
    },
  });
  if (!receipt) throw errors.notFound('Receipt not found.');

  const settings = await getSettings(req.tenant.id);
  const paidOnInvoice = await prisma.payment.aggregate({
    where: { tenantId: req.tenant.id, invoiceId: receipt.invoiceId },
    _sum: { amount: true },
  });

  ok(res, {
    ...serialize(receipt),
    invoice: {
      ...receipt.invoice,
      total: Number(receipt.invoice.total),
      amountPaid: Number(receipt.invoice.amountPaid),
      balanceDue: Number(receipt.invoice.balanceDue),
    },
    invoiceTotalPaid: Number(paidOnInvoice._sum.amount ?? 0),
    currency: { symbol: settings.currencySymbol, position: settings.currencyPosition },
  });
});

/* ── PDF / Email / WhatsApp ───────────────────────────────────────── */

export const receiptPdf = asyncHandler(async (req, res) => {
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true, invoice: true, payment: true },
  });
  if (!receipt) throw errors.notFound('Receipt not found.');
  if (receipt.status === 'VOID') throw errors.badRequest('This receipt has been voided.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({
    kind: 'RECEIPT',
    document: receipt,
    customer: receipt.customer,
    settings,
    payment: receipt.payment,
    invoice: receipt.invoice,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receipt.receiptNumber}.pdf"`);
  res.send(buffer);
});

export const receiptEmail = asyncHandler(async (req, res) => {
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true, invoice: true, payment: true },
  });
  if (!receipt) throw errors.notFound('Receipt not found.');

  const settings = await getSettings(req.tenant.id);
  const buffer = await buildDocumentPdf({
    kind: 'RECEIPT',
    document: receipt,
    customer: receipt.customer,
    settings,
    payment: receipt.payment,
    invoice: receipt.invoice,
  });
  const to = req.body?.to || receipt.customer?.email;

  await emailDocument({
    to,
    subject: req.body?.subject || `Receipt ${receipt.receiptNumber} from ${settings.businessName || req.tenant.name}`,
    message: req.body?.message || `Hello,\n\nWe have received your payment.\nReceipt: ${receipt.receiptNumber}\nAmount: ${formatMoney(receipt.amount, settings)}\n\nThank you.`,
    kind: 'RECEIPT',
    pdfBuffer: buffer,
    fileName: `${receipt.receiptNumber}.pdf`,
    previewUrl: previewUrlFor({ kind: 'RECEIPT', document: receipt }),
    settings,
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'SEND_RECEIPT', 'receipt', {
    entityId: receipt.id,
    entityLabel: receipt.receiptNumber,
    description: `${req.user.name} emailed receipt ${receipt.receiptNumber} to ${to}`,
  });

  ok(res, { message: 'Receipt emailed.' });
});

export const receiptShare = asyncHandler(async (req, res) => {
  const receipt = await prisma.receipt.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { customer: true },
  });
  if (!receipt) throw errors.notFound('Receipt not found.');
  const settings = await getSettings(req.tenant.id);
  ok(res, await sharePayload({ kind: 'RECEIPT', document: receipt, customer: receipt.customer, settings }));
});

/* ── VOID — receipts represent money, they are never casually deleted ── */

export const voidReceipt = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can void receipts.');

  const receipt = await prisma.receipt.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!receipt) throw errors.notFound('Receipt not found.');
  if (receipt.status === 'VOID') throw errors.badRequest('This receipt is already voided.');

  const reason = String(req.body?.reason || '').slice(0, 500);
  const updated = await prisma.receipt.update({
    where: { id: receipt.id },
    data: { status: 'VOID', voidReason: reason || null },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'VOID_RECEIPT', 'receipt', {
    entityId: receipt.id,
    entityLabel: receipt.receiptNumber,
    description: `${req.user.name} voided receipt ${receipt.receiptNumber}${reason ? ` — ${reason}` : ''}`,
  });

  ok(res, serialize(updated));
});

function endOfDay(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}
