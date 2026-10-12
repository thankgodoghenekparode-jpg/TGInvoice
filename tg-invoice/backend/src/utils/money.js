/**
 * Money arithmetic for financial documents.
 *
 * Rule: money never uses raw floating-point accumulation.
 * All calculations happen in integer minor units (kobo/cents) and are only
 * converted to decimal strings for storage. The frontend's numbers are never
 * trusted — the backend recomputes every total from line data.
 */

const toMinor = (value) => Math.round((Number(value) || 0) * 100);
const toMajor = (minor) => minor / 100;

/** Round a major-unit number to 2 decimals as a string (Prisma Decimal-safe). */
export const round2 = (value) => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);

/**
 * Compute one line item.
 *
 * lineSubtotal = quantity × unitPrice
 * discount     = PERCENT → subtotal × rate/100 (capped at subtotal), FIXED → value (capped)
 * taxable      = subtotal − discount
 * tax          = taxable × taxRate/100
 * amount       = taxable + tax
 *
 * @returns {{ lineSubtotal: string, discountAmount: string, taxableAmount: string,
 *            taxAmount: string, amount: string }}
 */
export function calculateLine({ quantity, unitPrice, discountType, discountValue, taxRate }) {
  const qty = Number(quantity) || 0;
  const priceMinor = toMinor(unitPrice);
  const lineSubtotalMinor = Math.round(qty * priceMinor);

  const discountValueMinor = toMinor(discountValue);
  let discountMinor = 0;
  if (discountType === 'PERCENT') {
    const pct = Number(discountValue) || 0;
    discountMinor = Math.round((lineSubtotalMinor * pct) / 100);
    if (discountMinor > lineSubtotalMinor) discountMinor = lineSubtotalMinor;
    if (pct < 0) discountMinor = 0;
  } else if (discountType === 'FIXED') {
    discountMinor = Math.min(Math.max(discountValueMinor, 0), lineSubtotalMinor);
  }

  const taxableMinor = lineSubtotalMinor - discountMinor;
  const rate = Number(taxRate) || 0;
  const taxMinor = rate > 0 ? Math.round((taxableMinor * rate) / 100) : 0;
  const amountMinor = taxableMinor + taxMinor;

  return {
    lineSubtotal: round2(toMajor(lineSubtotalMinor)),
    discountAmount: round2(toMajor(discountMinor)),
    taxableAmount: round2(toMajor(taxableMinor)),
    taxAmount: round2(toMajor(taxMinor)),
    amount: round2(toMajor(amountMinor)),
  };
}

/**
 * Roll line items up into document totals.
 * total = subtotal − discount + tax
 *
 * @param {Array} items raw items from the request
 * @returns {{ items: Array, subtotal: string, discountAmount: string,
 *            taxAmount: string, total: string }}
 */
export function calculateDocumentTotals(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const zero = round2(0);
    return { items: [], subtotal: zero, discountAmount: zero, taxAmount: zero, total: zero };
  }

  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;

  const computedItems = items.map((item) => {
    const line = calculateLine(item);
    subtotalMinor += toMinor(line.lineSubtotal);
    discountMinor += toMinor(line.discountAmount);
    taxMinor += toMinor(line.taxAmount);
    return { ...item, ...line };
  });

  const totalMinor = subtotalMinor - discountMinor + taxMinor;

  return {
    items: computedItems,
    subtotal: round2(toMajor(subtotalMinor)),
    discountAmount: round2(toMajor(discountMinor)),
    taxAmount: round2(toMajor(taxMinor)),
    total: round2(toMajor(totalMinor)),
  };
}

/** amountPaid = Σ payments; balanceDue = total − amountPaid (server-computed, never trusted). */
export function computeBalance(total, payments) {
  const totalMinor = toMinor(total);
  const paidMinor = (payments || []).reduce((sum, p) => sum + toMinor(p.amount), 0);
  const balanceMinor = totalMinor - paidMinor;
  return {
    amountPaid: round2(toMajor(paidMinor)),
    balanceDue: round2(toMajor(balanceMinor)),
  };
}

/**
 * Derive invoice status on the server. The client never sets PAID /
 * PARTIALLY_PAID / OVERDUE itself.
 *
 * @param {{ total: number, amountPaid: number, dueDate: Date|null,
 *           status: string }} invoice
 */
export function deriveInvoiceStatus({ total, amountPaid, dueDate, status }) {
  if (status === 'CANCELLED' || status === 'VOID') return status;
  if (status === 'DRAFT') return 'DRAFT'; // drafts never auto-advance

  const totalMinor = toMinor(total);
  const paidMinor = toMinor(amountPaid);

  if (totalMinor > 0 && paidMinor >= totalMinor) return 'PAID';

  const overdue =
    dueDate != null && paidMinor < totalMinor && new Date(dueDate).getTime() < Date.now();
  if (overdue) return 'OVERDUE';
  if (paidMinor > 0) return 'PARTIALLY_PAID';
  if (status === 'SENT') return 'SENT';
  return 'UNPAID';
}
