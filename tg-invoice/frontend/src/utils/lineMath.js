/**
 * Client-side mirror of backend money math (src/utils/money.js).
 * Used ONLY to preview totals while typing — the server always recomputes
 * and stores authoritative values in integer minor units.
 */

const toMinor = (v) => Math.round((Number(v) || 0) * 100);
const toMajor = (m) => m / 100;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function calcLine({ quantity, unitPrice, discountType, discountValue, taxRate }) {
  const priceMinor = toMinor(unitPrice);
  const lineSubtotalMinor = Math.round((Number(quantity) || 0) * priceMinor);

  let discountMinor = 0;
  if (discountType === 'PERCENT') {
    const pct = Number(discountValue) || 0;
    discountMinor = pct >= 0 ? Math.round((lineSubtotalMinor * pct) / 100) : 0;
    if (discountMinor > lineSubtotalMinor) discountMinor = lineSubtotalMinor;
  } else if (discountType === 'FIXED') {
    discountMinor = Math.min(Math.max(toMinor(discountValue), 0), lineSubtotalMinor);
  }

  const taxableMinor = lineSubtotalMinor - discountMinor;
  const rate = Number(taxRate) || 0;
  const taxMinor = rate > 0 ? Math.round((taxableMinor * rate) / 100) : 0;

  return {
    lineSubtotal: round2(toMajor(lineSubtotalMinor)),
    discountAmount: round2(toMajor(discountMinor)),
    taxAmount: round2(toMajor(taxMinor)),
    amount: round2(toMajor(taxableMinor + taxMinor)),
  };
}

export function calcTotals(items = []) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const item of items) {
    const line = calcLine(item);
    subtotal += toMinor(line.lineSubtotal);
    discount += toMinor(line.discountAmount);
    tax += toMinor(line.taxAmount);
  }
  return {
    subtotal: round2(toMajor(subtotal)),
    discountAmount: round2(toMajor(discount)),
    taxAmount: round2(toMajor(tax)),
    total: round2(toMajor(subtotal - discount + tax)),
  };
}
