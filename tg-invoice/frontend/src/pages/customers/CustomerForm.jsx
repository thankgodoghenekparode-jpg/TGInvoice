import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Field, LoadingBlock } from '../../components/ui.jsx';

const EMPTY = {
  name: '',
  companyName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  country: '',
  taxId: '',
  notes: '',
};

/** Shared create/edit form — /customers/new and /customers/:id/edit */
export default function CustomerFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!editing) return;
    api
      .get(`/customers/${id}`)
      .then(({ data }) => {
        const c = data.data;
        setForm({
          name: c.name || '',
          companyName: c.companyName || '',
          email: c.email || '',
          phone: c.phone || '',
          address: c.address || '',
          city: c.city || '',
          state: c.state || '',
          country: c.country || '',
          taxId: c.taxId || '',
          notes: c.notes || '',
        });
      })
      .catch((err) => {
        toast.error(apiMessage(err, 'Could not load the customer.'));
        navigate('/customers');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (editing) {
        await api.put(`/customers/${id}`, form);
        toast.success('Customer updated.');
      } else {
        await api.post('/customers', form);
        toast.success('Customer created.');
      }
      navigate(editing ? `/customers/${id}` : '/customers');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the customer.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading customer…" />;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={editing ? 'Edit customer' : 'New customer'}
        subtitle={editing ? 'Update the details shown on documents.' : 'Add a client you bill — a customer code is assigned automatically.'}
        actions={
          <Link to={editing ? `/customers/${id}` : '/customers'} className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Back
          </Link>
        }
      />

      <form onSubmit={submit} className="card space-y-5 p-6">
        <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Customer details</h2>
          <p className="mt-0.5 text-xs text-slate-500">The contact and billing information used on documents.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" required error={errors.name}>
            <input className="input" value={form.name} onChange={set('name')} placeholder="John Adeyemi" required />
          </Field>
          <Field label="Company name" error={errors.companyName} hint="Optional — shown as the display name.">
            <input className="input" value={form.companyName} onChange={set('companyName')} placeholder="Acme Studios Ltd" />
          </Field>
          <Field label="Email" error={errors.email}>
            <input type="email" className="input" value={form.email} onChange={set('email')} placeholder="billing@client.com" />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input className="input" value={form.phone} onChange={set('phone')} placeholder="+234 801 234 5678" />
          </Field>
          <Field label="Address" error={errors.address} className="sm:col-span-2">
            <input className="input" value={form.address} onChange={set('address')} placeholder="12 Marina Road" />
          </Field>
          <Field label="City" error={errors.city}>
            <input className="input" value={form.city} onChange={set('city')} placeholder="Lagos" />
          </Field>
          <Field label="State / Region" error={errors.state}>
            <input className="input" value={form.state} onChange={set('state')} placeholder="Lagos" />
          </Field>
          <Field label="Country" error={errors.country}>
            <input className="input" value={form.country} onChange={set('country')} placeholder="Nigeria" />
          </Field>
          <Field label="Tax ID / TIN" error={errors.taxId}>
            <input className="input" value={form.taxId} onChange={set('taxId')} placeholder="1234567890" />
          </Field>
          <Field label="Notes" error={errors.notes} className="sm:col-span-2" hint="Internal notes — never shown to the customer.">
            <textarea rows={3} className="input" value={form.notes} onChange={set('notes')} placeholder="Preferred contact days, discount agreements…" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Link to={editing ? `/customers/${id}` : '/customers'} className="btn btn-secondary btn-sm">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Save size={15} /> {busy ? 'Saving…' : editing ? 'Save changes' : 'Create customer'}
          </button>
        </div>
      </form>
    </div>
  );
}
