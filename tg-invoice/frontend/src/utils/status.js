/** Status badge metadata for documents (label + colours), shared app-wide. */

export const INVOICE_STATUS = {
  DRAFT: { label: 'Draft', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  SENT: { label: 'Sent', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  UNPAID: { label: 'Unpaid', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  PARTIALLY_PAID: { label: 'Partially Paid', className: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  PAID: { label: 'Paid', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  OVERDUE: { label: 'Overdue', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  CANCELLED: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
  VOID: { label: 'Void', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
  ISSUED: { label: 'Issued', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
};

export const QUOTATION_STATUS = {
  DRAFT: { label: 'Draft', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  SENT: { label: 'Sent', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  ACCEPTED: { label: 'Accepted', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Rejected', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  EXPIRED: { label: 'Expired', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  CONVERTED: { label: 'Converted', className: 'bg-violet-50 text-violet-700 ring-violet-200' },
};

export const statusMeta = (status, kind = 'invoice') =>
  (kind === 'quotation' ? QUOTATION_STATUS : INVOICE_STATUS)[status] || { label: status || '—', className: 'bg-slate-100 text-slate-600 ring-slate-200' };

/** 'quotation' → 'Quotation', 'invoice' → 'Invoice' (capitalised label). */
export const pluralLabel = (kind) => (kind === 'quotation' ? 'Quotation' : 'Invoice');

export const PRODUCT_CATEGORIES = [
  { value: 'METER_INSTALLATION', label: 'Meter Installation' },
  { value: 'METER_RELOCATION', label: 'Meter Relocation' },
  { value: 'ENERGY_SERVICE', label: 'Energy Service' },
  { value: 'TECHNICAL_SERVICE', label: 'Technical Service' },
  { value: 'CONSULTATION', label: 'Consultation' },
  { value: 'EQUIPMENT', label: 'Equipment' },
  { value: 'OTHER', label: 'Other' },
];

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'POS', label: 'POS' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'OTHER', label: 'Other' },
];

export const paymentMethodLabel = (m) => PAYMENT_METHODS.find((x) => x.value === m)?.label || m || '—';

export const categoryLabel = (c) => PRODUCT_CATEGORIES.find((x) => x.value === c)?.label || c || 'Other';
