import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Field, LoadingBlock } from '../../components/ui.jsx';
import { PRODUCT_CATEGORIES } from '../../utils/status.js';

const EMPTY = { name: '', description: '', category: 'Other', unit: '', unitPrice: '', taxRate: '', active: true };

export default function ProductFormPage() {
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
      .get(`/products/${id}`)
      .then(({ data }) => {
        const p = data.data;
        setForm({
          name: p.name || '',
          description: p.description || '',
          category: p.category || 'Other',
          unit: p.unit || '',
          unitPrice: p.unitPrice ?? '',
          taxRate: p.taxRate ?? '',
          active: p.active ?? true,
        });
      })
      .catch((err) => {
        toast.error(apiMessage(err, 'Could not load the product.'));
        navigate('/products');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const payload = {
      ...form,
      unitPrice: Number(form.unitPrice) || 0,
      taxRate: Number(form.taxRate) || 0,
    };
    try {
      if (editing) {
        await api.put(`/products/${id}`, payload);
        toast.success('Product updated.');
      } else {
        await api.post('/products', payload);
        toast.success('Product created.');
      }
      navigate('/products');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the product.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading product…" />;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={editing ? 'Edit product' : 'New product'}
        subtitle="Prices and tax defaults are applied when you add this item to a document."
        actions={
          <Link to="/products" className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Back
          </Link>
        }
      />

      <form onSubmit={submit} className="card space-y-5 p-6">
        <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Product details</h2>
          <p className="mt-0.5 text-xs text-slate-500">Used when adding this item to a document.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">
            <input className="input" value={form.name} onChange={set('name')} placeholder="Website design, monthly support, office chair..." required />
          </Field>
          <Field label="Category" error={errors.category} hint="e.g. Services, Products, Consulting, Maintenance">
            <input
              className="input"
              list="product-categories"
              value={form.category}
              onChange={set('category')}
              placeholder="Services"
            />
            <datalist id="product-categories">
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value} />
              ))}
            </datalist>
          </Field>
          <Field label="Unit" error={errors.unit} hint="e.g. hour, day, lump sum">
            <input className="input" value={form.unit} onChange={set('unit')} placeholder="service" />
          </Field>
          <Field label="Unit price" required error={errors.unitPrice}>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.unitPrice}
              onChange={set('unitPrice')}
              placeholder="0.00"
              required
            />
          </Field>
          <Field label="Default tax rate (%)" error={errors.taxRate}>
            <input type="number" min="0" max="100" step="0.01" className="input" value={form.taxRate} onChange={set('taxRate')} placeholder="0" />
          </Field>
          <Field label="Description" error={errors.description} className="sm:col-span-2">
            <textarea rows={3} className="input" value={form.description} onChange={set('description')} placeholder="What’s included…" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Active (available when creating documents)
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Link to="/products" className="btn btn-secondary btn-sm">Cancel</Link>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Save size={15} /> {busy ? 'Saving…' : editing ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </form>
    </div>
  );
}
