import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, UserPlus } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../services/api.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../context/ToastContext.jsx';
import { PageHeader, Field, LoadingBlock, Modal } from './ui.jsx';
import LineItems, { blankRow } from './LineItems.jsx';
import { todayInput, dateInputValue } from '../utils/dates.js';
import { track, EVENTS } from '../services/events.js';

const STATUS_OPTIONS = {
  QUOTATION: [
    { value: 'DRAFT', label: 'Draft' },
    { value: 'SENT', label: 'Sent' },
    { value: 'ACCEPTED', label: 'Accepted' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'EXPIRED', label: 'Expired' },
  ],
  INVOICE: [
    { value: 'UNPAID', label: 'Unpaid' },
    { value: 'SENT', label: 'Sent' },
    { value: 'DRAFT', label: 'Draft' },
  ],
};

/**
 * Create/edit form shared by quotations and invoices.
 * kind = 'QUOTATION' | 'INVOICE' ; id present → edit mode.
 */
export default function DocumentForm({ kind }) {
  const isInvoice = kind === 'INVOICE';
  const singular = isInvoice ? 'invoice' : 'quotation';
  const base = isInvoice ? '/invoices' : '/quotations';

  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { settings } = useSettings();

  const [form, setForm] = useState({
    customerId: searchParams.get('customerId') || '',
    reference: '',
    notes: '',
    terms: '',
    date: todayInput(),
    due: '',
    status: isInvoice ? 'UNPAID' : 'DRAFT',
  });
  const [items, setItems] = useState([blankRow({ taxRate: settings.defaultTaxRate || 0 })]);
  const [saveCustomItems, setSaveCustomItems] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [showValidation, setShowValidation] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState('');

  /* ── data loading ── */
  useEffect(() => {
    api
      .get('/customers', { params: { limit: 100, sort: 'name' } })
      .then(({ data }) => setCustomers(data.data || []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (!editing) return;
    api
      .get(`${base}/${id}`)
      .then(({ data }) => {
        const d = data.data;
        setForm({
          customerId: d.customerId,
          reference: d.reference || '',
          notes: d.notes || '',
          terms: d.terms || '',
          date: dateInputValue(isInvoice ? d.invoiceDate : d.quotationDate),
          due: dateInputValue(isInvoice ? d.dueDate : d.validUntil) || '',
          status: d.status,
        });
        const loaded = (d.items || [])
          .slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((it) => ({
            productId: it.productId || null,
            description: it.description,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            discountType: it.discountType || null,
            discountValue: Number(it.discountValue) || '',
            taxRate: Number(it.taxRate) || 0,
          }));
        setItems(loaded.length ? loaded : [blankRow()]);
      })
      .catch((err) => {
        toast.error(apiMessage(err, `Could not load the ${singular}.`));
        navigate(base);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ── quick customer creation (keeps your place in the form) ── */
  const createCustomer = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/customers', { name: quickName.trim() });
      setCustomers((list) => [...list, data.data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, customerId: data.data.id }));
      setErrors((prev) => (prev.customerId ? { ...prev, customerId: undefined } : prev));
      setQuickOpen(false);
      setQuickName('');
      toast.success(`Customer ${data.data.name} added.`);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not create the customer.'));
    }
  };

  const set = (key) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const updateItems = (next) => {
    setItems(next);
    setErrors((prev) => (prev.items ? { ...prev, items: undefined } : prev));
  };

  /**
   * What's still missing, in plain language. We validate on click rather than
   * disabling the button, so the user is always told *why* they can't save.
   */
  const validate = () => {
    const problems = [];
    if (!form.customerId) problems.push('select a customer');
    items.forEach((it, i) => {
      const line = `line ${i + 1}`;
      if (!it.description.trim()) problems.push(`${line} needs a description`);
      if (!(Number(it.quantity) > 0)) problems.push(`${line} needs a quantity above 0`);
      if (it.unitPrice === '' || Number.isNaN(Number(it.unitPrice))) problems.push(`${line} needs a unit price`);
    });
    return problems;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const problems = validate();
    if (problems.length) {
      setShowValidation(true);
      setErrors({
        customerId: form.customerId ? undefined : 'Select a customer.',
        items: `Please fix: ${problems.join(', ')}.`,
      });
      toast.error(`Can’t save yet — ${problems.join(', ')}.`);
      return;
    }

    setBusy(true);
    setErrors({});
    const payload = {
      customerId: form.customerId,
      reference: form.reference,
      notes: form.notes,
      terms: form.terms,
      status: form.status,
      saveCustomItems,
      items: items.map((it) => ({
        productId: it.productId || undefined,
        description: it.description.trim(),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        discountType: it.discountType || undefined,
        discountValue: it.discountValue === '' ? 0 : Number(it.discountValue),
        taxRate: Number(it.taxRate) || 0,
      })),
      ...(isInvoice
        ? { invoiceDate: form.date, dueDate: form.due || null }
        : { quotationDate: form.date, validUntil: form.due || null }),
    };
    try {
      if (editing) {
        const { data } = await api.put(`${base}/${id}`, payload);
        toast.success(`${isInvoice ? 'Invoice' : 'Quotation'} updated.`);
        navigate(`${base}/${data.data.id}`);
      } else {
        const { data } = await api.post(base, payload);
        track(isInvoice ? EVENTS.INVOICE_CREATED : EVENTS.QUOTATION_CREATED, {
          status: payload.status,
          lineItems: payload.items.length,
          fromProduct: payload.items.some((it) => Boolean(it.productId)),
        });
        toast.success(`${isInvoice ? 'Invoice' : 'Quotation'} ${data.data[isInvoice ? 'invoiceNumber' : 'quotationNumber']} created.`);
        navigate(`${base}/${data.data.id}`);
      }
    } catch (err) {
      toast.error(apiMessage(err, `Could not save the ${singular}.`));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label={`Loading ${singular}…`} />;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={editing ? `Edit ${singular} ${form.reference || ''}`.trim() : `New ${singular}`}
        subtitle={
          isInvoice
            ? 'Totals, balances and statuses are recalculated by the server when you save.'
            : 'Win the job — you can convert this to an invoice once it’s accepted.'
        }
        actions={
          <Link to={editing ? `${base}/${id}` : base} className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Back
          </Link>
        }
      />

      <form onSubmit={submit} noValidate className="space-y-6">
        {/* Meta */}
        <div className="card grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3 sm:col-span-2 lg:col-span-3">
            <h2 className="text-sm font-semibold text-slate-900">Document details</h2>
            <p className="mt-0.5 text-xs text-slate-500">Customer, dates and the notes printed on the document.</p>
          </div>
          <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">
            <div className="flex gap-2">
              <select className="input" value={form.customerId} onChange={set('customerId')} required>
                <option value="">— Select a customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName || c.name} {c.customerCode ? `(${c.customerCode})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                onClick={() => setQuickOpen(true)}
                title="Add customer without leaving the form"
              >
                <UserPlus size={15} />
              </button>
            </div>
          </Field>

          <Field label="Reference (your own note)" error={errors.reference}>
            <input className="input" value={form.reference} onChange={set('reference')} placeholder="PO number, project…" />
          </Field>

          <Field label={isInvoice ? 'Invoice date' : 'Quotation date'} required error={errors[isInvoice ? 'invoiceDate' : 'quotationDate']}>
            <input type="date" className="input" value={form.date} onChange={set('date')} required />
          </Field>

          <Field label={isInvoice ? 'Due date' : 'Valid until'} error={errors[isInvoice ? 'dueDate' : 'validUntil']}>
            <input type="date" className="input" value={form.due} onChange={set('due')} />
          </Field>

          <Field label="Status" error={errors.status}>
            <select className="input" value={form.status} onChange={set('status')}>
              {STATUS_OPTIONS[kind].map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Notes" error={errors.notes} className="sm:col-span-2 lg:col-span-3" hint="Shown at the bottom of the document.">
            <textarea rows={2} className="input" value={form.notes} onChange={set('notes')} placeholder="Thank you for your business…" />
          </Field>

          <Field label="Terms & conditions" error={errors.terms} className="sm:col-span-2 lg:col-span-3">
            <textarea rows={2} className="input" value={form.terms} onChange={set('terms')} placeholder="Payment within 14 days…" />
          </Field>
        </div>

        {/* Line items */}
        <div className="card p-6">
          <div className="mb-4 rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Line items</h2>
          </div>
          <LineItems items={items} onChange={updateItems} defaultTaxRate={settings.defaultTaxRate || 0} showErrors={showValidation} />
          {errors.items && <p className="mt-2 text-xs text-rose-600">{errors.items}</p>}

          <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={saveCustomItems}
              onChange={(e) => setSaveCustomItems(e.target.checked)}
            />
            <span className="text-xs leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-800">Save new items to Products &amp; services</span>
              <br />
              Anything you type here that isn’t already in your catalogue is added automatically, so you can reuse it next time. Items you pick from the list are never duplicated.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Prices in {settings.currency || 'NGN'} · the server re-validates every total on save.
          </p>
          <div className="flex gap-2">
            <Link to={editing ? `${base}/${id}` : base} className="btn btn-secondary btn-sm">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              <Save size={15} /> {busy ? 'Saving…' : editing ? `Save ${singular}` : `Create ${singular}`}
            </button>
          </div>
        </div>
      </form>

      {/* Quick customer modal */}
      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Add a customer"
        description="Create the customer and select them immediately."
        size="sm"
      >
        <form onSubmit={createCustomer} className="space-y-4">
          <Field label="Customer name" required>
            <input className="input" value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="Jane Doe / Acme Ltd" required autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuickOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={quickName.trim().length < 1}>
              <UserPlus size={15} /> Add & select
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
