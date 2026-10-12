import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Field, Button } from '../../components/ui.jsx';

const EMPTY = {
  invoicePrefix: 'INV',
  quotationPrefix: 'QT',
  receiptPrefix: 'REC',
  defaultTaxRate: 0,
  bankName: '',
  accountName: '',
  accountNumber: '',
  paymentInstructions: '',
  defaultInvoiceNotes: '',
  defaultQuotationTerms: '',
  defaultReceiptNotes: '',
};

export default function DocumentSettingsPage() {
  const toast = useToast();
  const { role } = useAuth();
  const { settings, refresh, loading } = useSettings();
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!settings || loading) return;
    setForm({
      invoicePrefix: settings.invoicePrefix || 'INV',
      quotationPrefix: settings.quotationPrefix || 'QT',
      receiptPrefix: settings.receiptPrefix || 'REC',
      defaultTaxRate: Number(settings.defaultTaxRate) || 0,
      bankName: settings.bankName || '',
      accountName: settings.accountName || '',
      accountNumber: settings.accountNumber || '',
      paymentInstructions: settings.paymentInstructions || '',
      defaultInvoiceNotes: settings.defaultInvoiceNotes || '',
      defaultQuotationTerms: settings.defaultQuotationTerms || '',
      defaultReceiptNotes: settings.defaultReceiptNotes || '',
    });
  }, [settings, loading]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.put('/settings', { ...form, defaultTaxRate: Number(form.defaultTaxRate) || 0 });
      toast.success('Document settings saved.');
      await refresh();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the settings.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  // Next number the server will allocate, with the (possibly unsaved) prefix typed here.
  const sampleNumber = (prefix, kind, fallback) => {
    const next = settings?.nextNumbers?.[kind] || '';
    const numeric = next ? next.slice(next.lastIndexOf('-') + 1) : '00001';
    return `${prefix || fallback}-${numeric}`;
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Documents & payments"
        subtitle="Numbering, defaults and the payment details printed on your documents."
        actions={
          <Link to="/settings" className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Settings
          </Link>
        }
      />

      {!canEdit && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Only owners and admins can change document settings.
        </div>
      )}

      <form onSubmit={submit} className="space-y-5">
        {/* Numbering */}
        <section className="card space-y-5 p-6">
          <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Document numbering</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Numbers are allocated by the server inside a database transaction, so two documents can never share a
              number. Prefixes may contain letters, numbers and dashes.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Invoice prefix" error={errors.invoicePrefix} hint={`Next: ${sampleNumber(form.invoicePrefix, 'INVOICE', 'INV')}`}>
              <input className="input uppercase" value={form.invoicePrefix} onChange={set('invoicePrefix')} disabled={!canEdit} maxLength={10} />
            </Field>
            <Field label="Quotation prefix" error={errors.quotationPrefix} hint={`Next: ${sampleNumber(form.quotationPrefix, 'QUOTATION', 'QT')}`}>
              <input className="input uppercase" value={form.quotationPrefix} onChange={set('quotationPrefix')} disabled={!canEdit} maxLength={10} />
            </Field>
            <Field label="Receipt prefix" error={errors.receiptPrefix} hint={`Next: ${sampleNumber(form.receiptPrefix, 'RECEIPT', 'REC')}`}>
              <input className="input uppercase" value={form.receiptPrefix} onChange={set('receiptPrefix')} disabled={!canEdit} maxLength={10} />
            </Field>
          </div>
        </section>

        {/* Defaults */}
        <section className="card space-y-5 p-6">
          <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Document defaults</h2>
            <p className="mt-0.5 text-xs text-slate-500">Pre-filled when you create a new document — always editable per document.</p>
          </div>

          <Field label="Default tax rate (%)" error={errors.defaultTaxRate} hint="Applied to new line items. You can override it per line.">
            <input type="number" min="0" max="100" step="0.01" className="input" value={form.defaultTaxRate} onChange={set('defaultTaxRate')} disabled={!canEdit} />
          </Field>

          <Field label="Default invoice notes" error={errors.defaultInvoiceNotes}>
            <textarea rows={2} className="input" value={form.defaultInvoiceNotes} onChange={set('defaultInvoiceNotes')} disabled={!canEdit}
              placeholder="Thank you for your business…" />
          </Field>

          <Field label="Default quotation terms" error={errors.defaultQuotationTerms}>
            <textarea rows={2} className="input" value={form.defaultQuotationTerms} onChange={set('defaultQuotationTerms')} disabled={!canEdit}
              placeholder="This quotation is valid for 30 days…" />
          </Field>

          <Field label="Default receipt notes" error={errors.defaultReceiptNotes}>
            <textarea rows={2} className="input" value={form.defaultReceiptNotes} onChange={set('defaultReceiptNotes')} disabled={!canEdit}
              placeholder="Payment received with thanks." />
          </Field>
        </section>

        {/* Payment details */}
        <section className="card space-y-5 p-6">
          <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Payment information</h2>
            <p className="mt-0.5 text-xs text-slate-500">Printed in the payment box of every invoice, quotation and receipt.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Bank name" error={errors.bankName}>
              <input className="input" value={form.bankName} onChange={set('bankName')} disabled={!canEdit} placeholder="GTBank" />
            </Field>
            <Field label="Account name" error={errors.accountName}>
              <input className="input" value={form.accountName} onChange={set('accountName')} disabled={!canEdit} />
            </Field>
            <Field label="Account number" error={errors.accountNumber}>
              <input className="input" value={form.accountNumber} onChange={set('accountNumber')} disabled={!canEdit} />
            </Field>
          </div>
          <Field label="Extra payment instructions" error={errors.paymentInstructions} hint="e.g. 'Use your invoice number as the transfer reference.'">
            <textarea rows={3} className="input" value={form.paymentInstructions} onChange={set('paymentInstructions')} disabled={!canEdit} />
          </Field>
        </section>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              <Save size={15} /> Save document settings
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
