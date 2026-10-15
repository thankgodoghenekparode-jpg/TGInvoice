import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, ReceiptText, UserPlus } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../../services/api.js';
import { creditNoteApi } from '../../services/creditNotes.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Field, LoadingBlock, Modal } from '../../components/ui.jsx';
import LineItems, { blankRow } from '../../components/LineItems.jsx';
import { todayInput, dateInputValue } from '../../utils/dates.js';

/** Create/edit a credit note. */
export default function CreditNoteFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { settings } = useSettings();

  const [form, setForm] = useState({
    customerId: searchParams.get('customerId') || '',
    invoiceId: searchParams.get('invoiceId') || '',
    creditNoteDate: todayInput(),
    reason: '',
    notes: '',
  });
  const [items, setItems] = useState([blankRow({ taxRate: settings.defaultTaxRate || 0 })]);
  const [saveCustomItems, setSaveCustomItems] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [showValidation, setShowValidation] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState('');

  useEffect(() => {
    api
      .get('/customers', { params: { limit: 100, sort: 'name' } })
      .then(({ data }) => setCustomers(data.data || []))
      .catch(() => setCustomers([]));
  }, []);

  // Invoices for the chosen customer (a credit note is applied per invoice).
  useEffect(() => {
    if (!form.customerId) {
      setInvoices([]);
      return;
    }
    api
      .get('/invoices', { params: { customerId: form.customerId, limit: 100 } })
      .then(({ data }) => setInvoices(data.data || []))
      .catch(() => setInvoices([]));
  }, [form.customerId]);

  useEffect(() => {
    if (!editing) return;
    creditNoteApi
      .get(id)
      .then((d) => {
        setForm({
          customerId: d.customerId,
          invoiceId: d.invoice?.id || d.invoiceId || '',
          creditNoteDate: dateInputValue(d.creditNoteDate),
          reason: d.reason || '',
          notes: d.notes || '',
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
        toast.error(apiMessage(err, 'Could not load the credit note.'));
        navigate('/credit-notes');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const createCustomer = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/customers', { name: quickName.trim() });
      setCustomers((list) => [...list, data.data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, customerId: data.data.id }));
      setQuickOpen(false);
      setQuickName('');
      toast.success(`Customer ${data.data.name} added.`);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not create the customer.'));
    }
  };

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === 'customerId' ? { invoiceId: '' } : {}) }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const updateItems = (next) => {
    setItems(next);
    setErrors((prev) => (prev.items ? { ...prev, items: undefined } : prev));
  };

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
      setErrors({ items: `Please fix: ${problems.join(', ')}.` });
      toast.error(`Can’t save yet — ${problems.join(', ')}.`);
      return;
    }

    setBusy(true);
    setErrors({});
    const payload = {
      customerId: form.customerId,
      invoiceId: form.invoiceId || null,
      creditNoteDate: form.creditNoteDate || undefined,
      reason: form.reason,
      notes: form.notes,
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
    };

    try {
      if (editing) {
        const saved = await creditNoteApi.update(id, payload);
        toast.success('Credit note updated.');
        navigate(`/credit-notes/${saved.id}`);
      } else {
        const saved = await creditNoteApi.create(payload);
        toast.success('Credit note created as a draft. Issue it to start crediting.');
        navigate(`/credit-notes/${saved.id}`);
      }
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the credit note.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading credit note…" />;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={editing ? 'Edit credit note' : 'New credit note'}
        subtitle="Credit a customer and, if you like, link it to an invoice so it can be applied against the balance."
        actions={
          <Link to="/credit-notes" className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Back
          </Link>
        }
      />

      <form onSubmit={submit} noValidate className="space-y-6">
        <div className="card grid gap-4 p-6 sm:grid-cols-2">
          <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3 sm:col-span-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ReceiptText className="size-4 text-brand-600" /> Credit note details
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Who the credit is for and why.</p>
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

          <Field
            label="Apply to invoice (optional)"
            error={errors.invoiceId}
            hint="Leave empty for a credit held on the customer's account."
          >
            <select className="input" value={form.invoiceId} onChange={set('invoiceId')} disabled={!form.customerId}>
              <option value="">— No specific invoice —</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} · {inv.status} · {inv.total}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Credit note date" error={errors.creditNoteDate}>
            <input type="date" className="input" value={form.creditNoteDate} onChange={set('creditNoteDate')} />
          </Field>

          <Field label="Reason" error={errors.reason} className="sm:col-span-2" hint="Shown on the credit note, e.g. 'Returned goods'.">
            <input className="input" value={form.reason} onChange={set('reason')} placeholder="Returned goods, overcharge…" maxLength={300} />
          </Field>

          <Field label="Notes" error={errors.notes} className="sm:col-span-2">
            <textarea rows={2} className="input" value={form.notes} onChange={set('notes')} placeholder="Internal or printed note…" />
          </Field>
        </div>

        <div className="card p-6">
          <div className="mb-4 rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Line items</h2>
            <p className="mt-0.5 text-xs text-slate-500">What you are crediting the customer for.</p>
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
              Anything you type here that isn’t already in your catalogue is added automatically, so you can reuse it next time.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to="/credit-notes" className="btn btn-secondary btn-sm">Cancel</Link>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Save size={15} /> {busy ? 'Saving…' : editing ? 'Save credit note' : 'Create credit note'}
          </button>
        </div>
      </form>

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
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuickOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={quickName.trim().length < 1}>
              <UserPlus size={15} /> Add &amp; select
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
