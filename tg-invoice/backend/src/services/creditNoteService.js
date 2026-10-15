import { errors } from '../utils/errors.js';
import { computeBalance, deriveInvoiceStatus, round2 } from '../utils/money.js';

/**
 * Credit notes: a negative document that says "we owe this customer".
 *
 * The balance invariant everywhere else in the app is
 *   amountPaid = Σ payments;  balanceDue = total − amountPaid
 * so applying a credit note MUST go through a Payment row (method
 * CREDIT_NOTE) — never by editing an invoice's total. That keeps outstanding
 * balances, "record payment" recomputation and reports all consistent.
 *
 * A credit note's lifecycle:
 *   DRAFT → ISSUED → APPLIED (fully applied)
 *                 ↘ VOID
 * `amountApplied` tracks how much has been absorbed by invoices; the rest is
 * available credit (which may be applied to another invoice or refunded).
 */

export const CREDIT_NOTE_INCLUDE = {
  customer: { select: { id: true, name: true, companyName: true, email: true, phone: true, customerCode: true } },
  items: { orderBy: { position: 'asc' } },
  invoice: { select: { id: true, invoiceNumber: true, status: true, total: true, balanceDue: true } },
  refunds: { orderBy: { refundDate: 'desc' } },
  createdBy: { select: { id: true, name: true } },
};

/** Numeric view of a credit note for API responses. */
export function serializeCreditNote(cn) {
  if (!cn) return cn;
  const total = Number(cn.total);
  const applied = Number(cn.amountApplied);
  return {
    ...cn,
    subtotal: Number(cn.subtotal),
    discountAmount: Number(cn.discountAmount),
    taxAmount: Number(cn.taxAmount),
    total,
    amountApplied: applied,
    creditRemaining: Math.round(Math.max(0, total - applied) * 100) / 100,
    items: cn.items?.map(serializeItem),
  };
}

export function serializeItem(it) {
  return {
    ...it,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
    discountValue: Number(it.discountValue),
    taxRate: Number(it.taxRate),
    amount: Number(it.amount),
  };
}

/** Map computed line items onto CreditNoteItem columns (which have no stored discount/tax amounts). */
export function creditNoteItemRows(items) {
  return items.map((it, index) => ({
    productId: it.productId || null,
    description: it.description,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discountType: it.discountType ?? null,
    discountValue: it.discountValue ?? 0,
    taxRate: it.taxRate ?? 0,
    amount: it.amount,
    position: index,
  }));
}

/**
 * Apply (part of) a credit note against an invoice, inside the caller's
 * transaction. Creates a CREDIT_NOTE-method Payment, then recomputes the
 * invoice's paid/balance/status from ALL its payments — never from client data.
 *
 * @returns {{ payment, invoice, creditNote, applied: string }}
 */
export async function applyCreditToInvoice(tx, { tenantId, creditNote, invoiceId, amount, userId }) {
  if (!creditNote) throw errors.notFound('Credit note not found.');
  if (creditNote.status === 'DRAFT') throw errors.badRequest('Issue the credit note before applying it to an invoice.');
  if (creditNote.status === 'VOID') throw errors.badRequest('This credit note has been voided and cannot be applied.');

  const remaining = Number(round2(Number(creditNote.total) - Number(creditNote.amountApplied)));
  if (remaining <= 0) throw errors.badRequest('This credit note has already been fully applied.');

  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { payments: true },
  });
  if (!invoice) throw errors.notFound('Invoice not found.');
  if (invoice.customerId !== creditNote.customerId) {
    throw errors.badRequest('A credit note can only be applied to an invoice belonging to the same customer.');
  }
  if (invoice.status === 'CANCELLED' || invoice.status === 'VOID') {
    throw errors.badRequest('This invoice is cancelled or voided — a credit note cannot be applied to it.');
  }
  if (invoice.status === 'DRAFT') {
    throw errors.badRequest('Save the invoice before applying a credit note to it.');
  }

  const outstanding = Number(computeBalance(invoice.total, invoice.payments).balanceDue);
  if (outstanding <= 0) throw errors.badRequest('This invoice has no outstanding balance to apply credit to.');

  const requested = amount != null ? Number(amount) : Math.min(remaining, outstanding);
  if (!(requested > 0)) throw errors.badRequest('Enter an amount greater than zero to apply.');

  const applyAmount = Math.min(requested, remaining, outstanding);
  if (applyAmount <= 0) throw errors.badRequest('Enter an amount greater than zero to apply.');

  const payment = await tx.payment.create({
    data: {
      tenantId,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      amount: round2(applyAmount),
      paymentDate: new Date(),
      paymentMethod: 'CREDIT_NOTE',
      reference: creditNote.creditNoteNumber,
      notes: `Credit note ${creditNote.creditNoteNumber} applied`,
      createdById: userId || null,
    },
  });

  const freshPayments = await tx.payment.findMany({ where: { invoiceId: invoice.id } });
  const recomputed = computeBalance(invoice.total, freshPayments);
  const status = deriveInvoiceStatus({
    total: invoice.total,
    amountPaid: recomputed.amountPaid,
    dueDate: invoice.dueDate,
    status: invoice.status,
  });
  const updatedInvoice = await tx.invoice.update({
    where: { id: invoice.id },
    data: { amountPaid: recomputed.amountPaid, balanceDue: recomputed.balanceDue, status },
  });

  const newApplied = round2(Number(creditNote.amountApplied) + applyAmount);
  const fullyApplied = Number(newApplied) >= Number(creditNote.total) - 0.001;
  const updatedCreditNote = await tx.creditNote.update({
    where: { id: creditNote.id },
    data: { amountApplied: newApplied, status: fullyApplied ? 'APPLIED' : 'ISSUED' },
    include: CREDIT_NOTE_INCLUDE,
  });

  return { payment, invoice: updatedInvoice, creditNote: updatedCreditNote, applied: round2(applyAmount) };
}
