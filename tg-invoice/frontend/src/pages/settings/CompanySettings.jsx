import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, Upload, Trash2, ImageOff } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Field, Button } from '../../components/ui.jsx';

const CURRENCIES = [
  { code: 'NGN', symbol: '₦', position: 'prefix', label: 'Nigerian Naira (NGN)' },
  { code: 'USD', symbol: '$', position: 'prefix', label: 'US Dollar (USD)' },
  { code: 'EUR', symbol: '€', position: 'prefix', label: 'Euro (EUR)' },
  { code: 'GBP', symbol: '£', position: 'prefix', label: 'British Pound (GBP)' },
  { code: 'GHS', symbol: 'GH₵', position: 'prefix', label: 'Ghanaian Cedi (GHS)' },
  { code: 'KES', symbol: 'KSh', position: 'prefix', label: 'Kenyan Shilling (KES)' },
  { code: 'ZAR', symbol: 'R', position: 'prefix', label: 'South African Rand (ZAR)' },
];

const EMPTY = {
  businessName: '', address: '', phone: '', email: '', website: '', taxId: '', country: '',
  currency: 'NGN', currencySymbol: '₦', currencyPosition: 'prefix',
  autoSendChannels: [],
};

const DELIVERY_CHANNELS = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SMS', label: 'SMS' },
  { value: 'EMAIL', label: 'Email' },
];

export default function CompanySettingsPage() {
  const toast = useToast();
  const { role, refreshSession } = useAuth();
  const { settings, refresh, loading } = useSettings();
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [logoBusy, setLogoBusy] = useState(false);
  const [fileInput, setFileInput] = useState(null);

  useEffect(() => {
    if (!settings || loading) return;
    setForm({
      businessName: settings.businessName || '',
      address: settings.address || '',
      phone: settings.phone || '',
      email: settings.email || '',
      website: settings.website || '',
      taxId: settings.taxId || '',
      country: settings.country || '',
      currency: settings.currency || 'NGN',
      currencySymbol: settings.currencySymbol || '₦',
      currencyPosition: settings.currencyPosition || 'prefix',
      autoSendChannels: Array.isArray(settings.autoSendChannels) ? settings.autoSendChannels : [],
    });
  }, [settings, loading]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleChannel = (value) =>
    setForm((f) => ({
      ...f,
      autoSendChannels: f.autoSendChannels.includes(value)
        ? f.autoSendChannels.filter((c) => c !== value)
        : [...f.autoSendChannels, value],
    }));

  const pickCurrency = (code) => {
    const c = CURRENCIES.find((x) => x.code === code);
    setForm((f) => ({
      ...f,
      currency: code,
      currencySymbol: c ? c.symbol : f.currencySymbol,
      currencyPosition: c ? c.position : f.currencyPosition,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.put('/settings', form);
      toast.success('Company profile saved.');
      await refresh();
      if (data.data?.businessName) await refreshSession?.();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the settings.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be 2 MB or smaller.');
      return;
    }
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      fd.append('previous', settings.logo || '');
      await api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Logo updated.');
      await refresh();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not upload the logo.'));
    } finally {
      setLogoBusy(false);
      if (fileInput) fileInput.value = '';
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await api.delete('/settings/logo');
      toast.success('Logo removed.');
      await refresh();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not remove the logo.'));
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Company profile"
        subtitle="Printed on every invoice, quotation and receipt you issue."
        actions={
          <Link to="/settings" className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Settings
          </Link>
        }
      />

      {!canEdit && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Only owners and admins can change company settings. You can still review them here.
        </div>
      )}

      {/* Logo */}
      <div className="card-blue mb-5 flex flex-wrap items-center gap-5 p-6">
        {settings.logo ? (
          <img src={settings.logo} alt="Logo" className="size-20 rounded-xl object-contain ring-1 ring-slate-200" />
        ) : (
          <div className="flex size-20 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
            <ImageOff size={24} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Business logo</p>
          <p className="mt-0.5 text-xs text-slate-500">PNG, JPG or WEBP up to 2 MB. Square works best.</p>
          <div className="mt-3 flex gap-2">
            <label className={`btn btn-secondary btn-sm ${!canEdit || logoBusy ? 'pointer-events-none opacity-50' : ''}`}>
              <Upload size={15} /> {logoBusy ? 'Uploading…' : 'Upload logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                ref={setFileInput}
                onChange={(e) => uploadLogo(e.target.files?.[0])}
              />
            </label>
            {settings.logo && canEdit && (
              <button type="button" className="btn btn-ghost btn-sm text-rose-600" onClick={removeLogo} disabled={logoBusy}>
                <Trash2 size={15} /> Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="card space-y-5 p-6">
        <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Company details</h2>
          <p className="mt-0.5 text-xs text-slate-500">Shown on every invoice, quotation and receipt you issue.</p>
        </div>
        <Field label="Business name" required error={errors.businessName}>
          <input className="input" value={form.businessName} onChange={set('businessName')} required disabled={!canEdit} />
        </Field>

        <Field label="Address" error={errors.address}>
          <textarea rows={3} className="input" value={form.address} onChange={set('address')} disabled={!canEdit}
            placeholder={'123 Adeola Odeku Street\nVictoria Island, Lagos'} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Phone" error={errors.phone}>
            <input className="input" value={form.phone} onChange={set('phone')} disabled={!canEdit} placeholder="+234 801 234 5678" />
          </Field>
          <Field label="Email" error={errors.email}>
            <input type="email" className="input" value={form.email} onChange={set('email')} disabled={!canEdit} />
          </Field>
          <Field label="Website" error={errors.website}>
            <input className="input" value={form.website} onChange={set('website')} disabled={!canEdit} placeholder="https://yourbusiness.com" />
          </Field>
          <Field label="Tax ID / RC number" error={errors.taxId}>
            <input className="input" value={form.taxId} onChange={set('taxId')} disabled={!canEdit} />
          </Field>
          <Field label="Country" error={errors.country}>
            <input className="input" value={form.country} onChange={set('country')} disabled={!canEdit} />
          </Field>
          <Field label="Currency" error={errors.currency} hint="Changing currency does not convert existing amounts.">
            <select className="input" value={form.currency} onChange={(e) => pickCurrency(e.target.value)} disabled={!canEdit}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Auto-send documents"
            hint="When you mark an invoice or quotation as sent, it is pushed automatically over these channels. Leave empty to send manually. Unconfigured channels are ignored."
          >
            <div className="flex flex-wrap gap-2">
              {DELIVERY_CHANNELS.map((c) => {
                const active = form.autoSendChannels.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleChannel(c.value)}
                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        {canEdit && (
          <div className="flex justify-end border-t border-slate-100 pt-5">
            <Button type="submit" loading={busy}>
              <Save size={15} /> Save profile
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
