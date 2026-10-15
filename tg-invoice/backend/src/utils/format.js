/** Formatting helpers shared by the API (PDFs, email bodies, CSV). */

/**
 * Format a money amount with the tenant's own currency configuration.
 * @param {number|string} value
 * @param {{ currencySymbol?: string, currencyPosition?: string, currencyDecimals?: number }} settings
 */
export function formatMoney(value, settings = {}) {
  const symbol = settings.currencySymbol || '₦';
  const position = settings.currencyPosition || 'prefix';
  const decimals = settings.currencyDecimals ?? 2;
  const n = Number(value) || 0;
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return position === 'suffix' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const PAYMENT_METHOD_LABELS = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  POS: 'POS',
  CHEQUE: 'Cheque',
  ONLINE: 'Online',
  OTHER: 'Other',
  CREDIT_NOTE: 'Credit applied',
};

export function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || method || '';
}

/** WhatsApp click-to-chat message for a document (spec §50). */
export function whatsappMessage({ kind, customerName, businessName, documentNumber, amount, settings, previewUrl }) {
  const label =
    kind === 'QUOTATION' ? 'Quotation'
      : kind === 'RECEIPT' ? 'Receipt'
        : kind === 'CREDIT_NOTE' ? 'Credit note'
          : kind === 'REFUND' ? 'Refund'
            : 'Invoice';
  const lines = [
    `Hello ${customerName},`,
    '',
    `Please find your ${label} from ${businessName}.`,
    '',
    `Document: ${documentNumber}`,
    `Amount: ${amount}`,
  ];
  if (previewUrl) lines.push('', `View or download it here: ${previewUrl}`);
  lines.push('', 'Thank you.');
  return lines.join('\n');
}

/** CSV escape for report exports. */
export function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
