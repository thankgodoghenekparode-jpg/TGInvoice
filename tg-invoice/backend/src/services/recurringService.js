import { prisma } from '../prisma.js';
import { calculateDocumentTotals } from '../utils/money.js';
import { allocateDocumentNumber } from './sequenceService.js';
import { getSettings } from './documentService.js';
import { enqueue } from './jobService.js';

/**
 * Recurring invoices.
 *
 * A business templates a customer + line items once; the worker then raises the
 * invoice automatically every N weeks/months/years. Generation is idempotent
 * across workers because the schedule is advanced in the SAME statement that
 * leases the row (`FOR UPDATE SKIP LOCKED`), so a second worker never sees the
 * same due invoice.
 */

const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'];

/** SQL interval expression for a frequency + interval (used to advance the clock). */
const INTERVAL_SQL = `
  CASE r.frequency
    WHEN 'WEEKLY'     THEN make_interval(weeks  => r.interval)
    WHEN 'MONTHLY'    THEN make_interval(months => r.interval)
    WHEN 'QUARTERLY'  THEN make_interval(months => 3 * r.interval)
    WHEN 'SEMIANNUAL' THEN make_interval(months => 6 * r.interval)
    WHEN 'ANNUAL'     THEN make_interval(years  => r.interval)
    ELSE make_interval(months => r.interval)
  END`;

/** JavaScript equivalent of INTERVAL_SQL, for previews and the API. */
export function addInterval(date, frequency, interval = 1) {
  const d = new Date(date);
  const n = Math.max(1, Number(interval) || 1);
  switch (frequency) {
    case 'WEEKLY':
      d.setDate(d.getDate() + 7 * n);
      break;
    case 'QUARTERLY':
      d.setMonth(d.getMonth() + 3 * n);
      break;
    case 'SEMIANNUAL':
      d.setMonth(d.getMonth() + 6 * n);
      break;
    case 'ANNUAL':
      d.setFullYear(d.getFullYear() + n);
      break;
    case 'MONTHLY':
    default:
      d.setMonth(d.getMonth() + n);
      break;
  }
  return d;
}

export const isFrequency = (value) => FREQUENCIES.includes(value);

/**
 * Atomically lease ONE due recurring invoice, advancing its schedule.
 * Returns the leased template row (pre-advance values) or null.
 */
async function leaseDueRecurring() {
  const rows = await prisma.$queryRawUnsafe(`
    UPDATE "RecurringInvoice" r
    SET "lastRunAt" = now(),
        "nextRunAt" = r."nextRunAt" + (${INTERVAL_SQL}),
        "generatedCount" = r."generatedCount" + 1,
        "updatedAt" = now()
    WHERE r.id = (
      SELECT id FROM "RecurringInvoice"
      WHERE status = 'ACTIVE'
        AND "nextRunAt" <= now()
        AND ("endDate" IS NULL OR "endDate" >= now())
      ORDER BY "nextRunAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING r.*`);
  return rows?.[0] ?? null;
}

const toLineRows = (items) =>
  items.map((it, index) => ({
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

/**
 * Raise one invoice from a leased recurring template. Runs in its own
 * transaction so the number allocation and the invoice row commit together.
 */
export async function generateInvoiceFromRecurring(rec) {
  const settings = await getSettings(rec.tenantId);
  const items = await prisma.recurringInvoiceItem.findMany({
    where: { recurringInvoiceId: rec.id },
    orderBy: { position: 'asc' },
  });
  const totals = calculateDocumentTotals(items);

  const now = new Date();
  const dueDate = new Date(now.getTime() + (rec.dueInDays ?? 14) * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const invoiceNumber = await allocateDocumentNumber(tx, rec.tenantId, 'INVOICE', settings);
    return tx.invoice.create({
      data: {
        tenantId: rec.tenantId,
        customerId: rec.customerId,
        recurringInvoiceId: rec.id,
        invoiceNumber,
        invoiceDate: now,
        dueDate,
        reference: rec.reference || null,
        status: 'UNPAID',
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        amountPaid: 0,
        balanceDue: totals.total,
        notes: rec.notes || settings.defaultInvoiceNotes || null,
        terms: rec.terms || null,
        createdById: rec.createdById || null,
        items: { create: toLineRows(totals.items) },
      },
      include: { customer: true, items: true },
    });
  });
}

/** Close out templates whose end date has passed. */
async function completeFinishedTemplates() {
  const { count } = await prisma.recurringInvoice.updateMany({
    where: { status: 'ACTIVE', endDate: { lt: new Date() } },
    data: { status: 'COMPLETED' },
  });
  return count;
}

/**
 * Generate every invoice that is currently due.
 * Returns a small report so the job log is useful.
 */
export async function runDueRecurringInvoices({ limit = 50 } = {}) {
  await completeFinishedTemplates().catch(() => {});

  const generated = [];
  const failed = [];

  for (let i = 0; i < limit; i += 1) {
    const rec = await leaseDueRecurring();
    if (!rec) break;
    try {
      const invoice = await generateInvoiceFromRecurring(rec);
      generated.push({ recurringInvoiceId: rec.id, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber });

      // Auto-send (WhatsApp/SMS/email) when the template asks for it.
      if (rec.autoSend) {
        await enqueue('document.autoDeliver', {
          kind: 'INVOICE',
          documentId: invoice.id,
          tenantId: rec.tenantId,
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`[recurring] ${rec.id}:`, err?.message);
      failed.push({ recurringInvoiceId: rec.id, error: err?.message });
      // Back the schedule up so the next tick retries instead of skipping a period.
      await prisma.recurringInvoice
        .update({ where: { id: rec.id }, data: { status: 'PAUSED' } })
        .catch(() => {});
    }
  }

  return { generated, failed, count: generated.length };
}

/** The next few run dates, for the create/edit form preview. */
export function upcomingRunDates({ frequency, interval, from = new Date(), count = 3 }) {
  const dates = [];
  let cursor = new Date(from);
  for (let i = 0; i < count; i += 1) {
    cursor = addInterval(cursor, frequency, interval);
    dates.push(cursor);
  }
  return dates;
}
