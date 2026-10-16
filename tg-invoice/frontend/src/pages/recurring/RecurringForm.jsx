import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, Repeat, UserPlus } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../../services/api.js';
import { recurringApi, FREQUENCY_LABELS } from '../../services/billing.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Field, LoadingBlock, Modal, Select } from '../../components/ui.jsx';
import LineItems, { blankRow } from '../../components/LineItems.jsx';
import { todayInput, dateInputValue, formatDate } from '../../utils/dates.js';
import { track, EVENTS } from '../../services/events.js';

const INTERVAL_UNITS = {
  WEEKLY: 'week(s)',
  MONTHLY: 'month(s)',
  QUARTERLY: 'quarter(s)',
  SEMIANNUAL: '6-month period(s)',
  ANNUAL: 'year(s)',
};

/** Create/edit a recurring invoice schedule. */
export default function RecurringFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { settings } = useSettings();

  const [form, setForm] = useState({
    customerId: searchParams.get('customerId') || '',
    name: '',
    frequency: 'MONTHLY',
    interval: 1,
    nextRunAt: todayInput(),
    endDate: '',
    dueInDays: settings.dueInDays ?? 14,
    autoSend: true,
    status: 'ACTIVE',
    reference: '',
    notes: '',
    terms: '',
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

  useEffect(() => {
    api
      .get('/customers', { params: { limit: 100, sort: 'name' } })
      .then(({ data }) => setCustomers(data.data || []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (!editing) return;
    recurringApi
      .get(id)
      .then((d) => {
        setForm({
          customerId: d.customerId,
          name: d.name || '',
          frequency: d.frequency,
          interval: Number(d.interval) || 1,
          nextRunAt: dateInputValue(d.nextRunAt),
          endDate: dateInputValue(d.endDate) || '',
          dueInDays: d.dueInDays ?? 14,
          autoSend: Boolean(d.autoSend),
          status: d.status,
          reference: d.reference || '',
          notes: d.notes || '',
          terms: d.terms || '',
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
        toast.error(apiMessage(err, 'Could not load the schedule.'));
        navigate('/recurring');
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
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const updateItems = (next) => {
    setItems(next);
    setErrors((prev) => (prev.items ? { ...prev, items: undefined } : prev));
  };

  const validate = () => {
    const problems = [];
    if (!form.name.trim()) problems.push('give the schedule a name');
    if (!form.customerId) problems.push('select a customer');
    if (!(Number(form.interval) >= 1)) problems.push('repeat at least every 1');
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
      name: form.name.trim(),
      frequency: form.frequency,
      interval: Number(form.interval) || 1,
      nextRunAt: form.nextRunAt || undefined,
      endDate: form.endDate || null,
      dueInDays: Number(form.dueInDays) || 0,
      autoSend: form.autoSend,
      status: form.status,
      reference: form.reference,
      notes: form.notes,
      terms: form.terms,
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
        await recurringApi.update(id, payload);
        toast.success('Schedule updated.');
      } else {
        await recurringApi.create(payload);
        track(EVENTS.RECURRING_CREATED, { frequency: payload.frequency, autoSend: payload.autoSend });
        toast.success('Schedule created. The first invoice is raised on its start date.');
      }
      navigate('/recurring');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the schedule.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading schedule…" />;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={editing ? 'Edit recurring invoice' : 'New recurring invoice'}
        subtitle="TG Invoice raises the invoice for you on the schedule below and, if you like, sends it automatically."
        actions={
          <Link to="/recurring" className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Back
          </Link>
        }
      />

      <form onSubmit={submit} noValidate className="space-y-6">
        <div className="card grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3 sm:col-span-2 lg:col-span-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Repeat className="size-4 text-brand-600" /> Schedule details
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">What to invoice, for whom, and how often.</p>
          </div>

          <Field label="Schedule name" required error={errors.name} className="sm:col-span-2">
            <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Monthly support retainer" required />
          </Field>

          <Field label="Customer" required error={errors.customerId} className="sm:col-span-2 lg:col-span-3">
            <div className="flex gap-2">
              <select className="input" value={form.customerId} onChange={set('customerId')} required>
                <option value="">— Select a customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName || c.name} {c.customerCode ? `(${c.customerCode})` : ''}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => setQuickOpen(true)} title="Add customer without leaving the form">
                <UserPlus size={15} />
              </button>
            </div>
          </Field>

          <Field label="Repeats every" required error={errors.interval}>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max="60"
                className="input w-20 text-right"
                value={form.interval}
                onChange={set('interval')}
              />
              <Select value={form.frequency} onChange={set('frequency')} className="flex-1">
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </div>
            <p className="mt-1 text-xs text-slate-400">Every {form.interval || 1} {INTERVAL_UNITS[form.frequency]}</p>
          </Field>

          <Field label="First invoice on" required error={errors.nextRunAt}>
            <input type="date" className="input" value={form.nextRunAt} onChange={set('nextRunAt')} required />
          </Field>

          <Field label="Ends on (optional)" error={errors.endDate} hint="Leave empty to run indefinitely.">
            <input type="date" className="input" value={form.endDate} onChange={set('endDate')} />
          </Field>

          <Field label="Payment due (days after issue)" error={errors.dueInDays}>
            <input type="number" min="0" max="365" className="input" value={form.dueInDays} onChange={set('dueInDays')} />
          </Field>

          <Field label="Status" error={errors.status}>
            <Select value={form.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="COMPLETED">Completed</option>
            </Select>
          </Field>

          <Field label="Reference (your own note)" error={errors.reference}>
            <input className="input" value={form.reference} onChange={set('reference')} placeholder="PO number, project…" />
          </Field>

          <Field label="Notes" error={errors.notes} className="sm:col-span-2 lg:col-span-3" hint="Shown at the bottom of each generated invoice.">
            <textarea rows={2} className="input" value={form.notes} onChange={set('notes')} placeholder="Thank you for your business…" />
          </Field>

          <Field label="Terms & conditions" error={errors.terms} className="sm:col-span-2 lg:col-span-3">
            <textarea rows={2} className="input" value={form.terms} onChange={set('terms')} placeholder="Payment within 14 days…" />
          </Field>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 sm:col-span-2 lg:col-span-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.autoSend}
              onChange={set('autoSend')}
            />
            <span className="text-xs leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-800">Send each invoice automatically</span>
              <br />
              Deliveries go out on the channels enabled in Settings → Messaging (WhatsApp, SMS, email). You can always send manually afterwards.
            </span>
          </label>
        </div>

        <div className="card p-6">
          <div className="mb-4 rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Line items</h2>
            <p className="mt-0.5 text-xs text-slate-500">These repeat on every invoice. Edit them any time — past invoices are unaffected.</p>
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Prices in {settings.currency || 'NGN'}
            {form.nextRunAt ? ` · first invoice on ${formatDate(form.nextRunAt)}` : ''}
          </p>
          <div className="flex gap-2">
            <Link to="/recurring" className="btn btn-secondary btn-sm">Cancel</Link>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              <Save size={15} /> {busy ? 'Saving…' : editing ? 'Save schedule' : 'Create schedule'}
            </button>
          </div>
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
