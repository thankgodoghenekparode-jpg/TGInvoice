import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Palette, CreditCard, CheckCheck, Upload, ArrowRight, ArrowLeft, SkipForward } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { CURRENCY_PRESETS } from '../utils/currency.js';
import { Button, Field } from '../components/ui.jsx';

const STEPS = [
  { key: 'business', label: 'Business', icon: Building2, title: 'Tell clients who you are', sub: 'These details appear on every document you send.' },
  { key: 'branding', label: 'Branding', icon: Palette, title: 'Logo & currency', sub: 'Look professional and bill in your own currency.' },
  { key: 'payments', label: 'Payments', icon: CreditCard, title: 'How should clients pay?', sub: 'Bank details printed on invoices and receipts.' },
  { key: 'finish', label: 'Finish', icon: CheckCheck, title: 'You’re ready to invoice', sub: 'Add a customer, then create your first quotation.' },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeTenant, refreshSession } = useAuth();
  const { settings, loading, refresh } = useSettings();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [logoPreview, setLogoPreview] = useState(null);

  const [form, setForm] = useState({
    businessName: '',
    address: '',
    phone: '',
    email: '',
    taxId: '',
    country: 'Nigeria',
    currency: 'NGN',
    logo: null,
    bankName: '',
    accountName: '',
    accountNumber: '',
    paymentInstructions: '',
  });

  // Prefill from anything already saved (register created partial settings).
  // Latched per tenant: switching businesses must never carry another
  // workspace's name, address or bank details into this one.
  useEffect(() => {
    if (loading || !settings?.tenantId || form._loadedFor === settings.tenantId) return;
    setForm((f) => ({
      ...f,
      _loadedFor: settings.tenantId,
      businessName: settings.businessName || activeTenant?.name || '',
      address: settings.address || '',
      phone: settings.phone || '',
      email: settings.email || '',
      taxId: settings.taxId || '',
      country: settings.country || 'Nigeria',
      currency: settings.currency || 'NGN',
      bankName: settings.bankName || '',
      accountName: settings.accountName || '',
      accountNumber: settings.accountNumber || '',
      paymentInstructions: settings.paymentInstructions || '',
      logo: settings.logo || null,
    }));
    setLogoPreview(settings.logo || null);
  }, [settings, loading, activeTenant, form._loadedFor]);

  // Already finished onboarding? Go straight to the dashboard.
  useEffect(() => {
    if (!loading && settings?.onboardingComplete) navigate('/dashboard', { replace: true });
  }, [loading, settings, navigate]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const persist = async (extra = {}) => {
    const payload = {
      businessName: form.businessName.trim() || undefined,
      address: form.address,
      phone: form.phone,
      email: form.email,
      taxId: form.taxId,
      country: form.country,
      bankName: form.bankName,
      accountName: form.accountName,
      accountNumber: form.accountNumber,
      paymentInstructions: form.paymentInstructions,
      ...extra,
    };
    const preset = CURRENCY_PRESETS.find((c) => c.code === form.currency);
    if (preset) {
      payload.currency = preset.code;
      payload.currencySymbol = preset.symbol;
      payload.currencyPosition = 'prefix';
    }
    Object.keys(payload).forEach((k) => payload[k] === '' && delete payload[k]);
    const { data } = await api.put('/settings', payload);
    return data.data;
  };

  const next = async () => {
    setErrors({});
    if (step === 0 && form.businessName.trim().length < 2) {
      setErrors({ businessName: 'Business name is required.' });
      return;
    }
    setBusy(true);
    try {
      await persist();
      if (step === 1 && form.logo instanceof File) {
        const fd = new FormData();
        fd.append('logo', form.logo);
        await api.post('/settings/logo', fd);
      }
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save your settings.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await persist({ onboardingComplete: true });
      await refresh();
      await refreshSession?.();
      toast.success('Setup complete — welcome to TG Invoice!');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(apiMessage(err, 'Could not finish setup.'));
    } finally {
      setBusy(false);
    }
  };

  const skipTo = async (index) => {
    setBusy(true);
    try {
      if (index === STEPS.length - 1) await persist({ onboardingComplete: true });
      else await persist();
      setStep(index);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save your settings.'));
    } finally {
      setBusy(false);
    }
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be 2 MB or smaller.');
      return;
    }
    set({ logo: file });
    setLogoPreview(URL.createObjectURL(file));
  };

  const current = STEPS[step];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">TG</span>
            <span className="font-semibold tracking-tight">TG Invoice <span className="text-xs font-normal text-slate-400">by tgeasy</span></span>
          </div>
          <button
            type="button"
            className="text-sm text-slate-400 hover:text-slate-700"
            onClick={() => skipTo(STEPS.length - 1)}
          >
            Skip setup
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        {/* Progress */}
        <ol className="mb-8 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {i < step ? '✓' : i + 1}
              </span>
              <span className={`hidden text-xs font-medium sm:block ${i === step ? 'text-slate-800' : 'text-slate-400'}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
            </li>
          ))}
        </ol>

        <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/70 via-white to-white p-6 shadow-soft sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{current.title}</h1>
            <p className="mt-1 text-sm text-slate-500">{current.sub}</p>
          </div>

          {/* ── Step 0: business ── */}
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" required error={errors.businessName} className="sm:col-span-2">
                <input className="input" value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="e.g. Acme Studios Ltd" />
              </Field>
              <Field label="Business email" error={errors.email}>
                <input type="email" className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="billing@business.com" />
              </Field>
              <Field label="Phone" error={errors.phone}>
                <input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+234 801 234 5678" />
              </Field>
              <Field label="Country" error={errors.country}>
                <input className="input" value={form.country} onChange={(e) => set({ country: e.target.value })} />
              </Field>
              <Field label="Tax ID / TIN (optional)" error={errors.taxId}>
                <input className="input" value={form.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder="1234567890" />
              </Field>
              <Field label="Address" error={errors.address} className="sm:col-span-2" hint="Shown on invoices, quotations and receipts.">
                <textarea rows={2} className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="12 Marina Road, Lagos" />
              </Field>
            </div>
          )}

          {/* ── Step 1: branding ── */}
          {step === 1 && (
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="label">Logo</p>
                <div className="flex items-center gap-4">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="size-20 rounded-lg border border-slate-200 object-contain bg-white" />
                  ) : (
                    <div className="flex size-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                      <Upload size={22} />
                    </div>
                  )}
                  <label className="btn btn-secondary btn-sm cursor-pointer">
                    Upload image
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} />
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-400">PNG, JPG or WEBP up to 2 MB. Square works best.</p>
              </div>
              <Field label="Currency" hint="Used for all money in this business.">
                <select className="input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                  {CURRENCY_PRESETS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name} ({c.symbol})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {/* ── Step 2: payments ── */}
          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank name">
                <input className="input" value={form.bankName} onChange={(e) => set({ bankName: e.target.value })} placeholder="GTBank" />
              </Field>
              <Field label="Account name">
                <input className="input" value={form.accountName} onChange={(e) => set({ accountName: e.target.value })} placeholder="e.g. Acme Studios Ltd" />
              </Field>
              <Field label="Account number">
                <input className="input" value={form.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} placeholder="0123456789" />
              </Field>
              <Field label="Payment instructions (optional)" className="sm:col-span-2">
                <textarea
                  rows={3}
                  className="input"
                  value={form.paymentInstructions}
                  onChange={(e) => set({ paymentInstructions: e.target.value })}
                  placeholder="Kindly use the invoice number as the transfer description."
                />
              </Field>
            </div>
          )}

          {/* ── Step 3: finish ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                <p className="font-semibold">Everything is configured.</p>
                <p className="mt-1">Your documents will use your branding, currency and bank details automatically.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: 'Add a customer', to: '/customers/new' },
                  { label: 'Create a quotation', to: '/quotations/new' },
                  { label: 'Create an invoice', to: '/invoices/new' },
                ].map((a) => (
                  <div key={a.label} className="rounded-xl border border-brand-100 bg-white p-3 text-sm font-medium text-slate-700">
                    {a.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <Button
              variant="ghost"
              onClick={() => (step === 0 ? skipTo(STEPS.length - 1) : setStep((s) => s - 1))}
              disabled={busy}
            >
              {step === 0 ? <SkipForward size={15} /> : <ArrowLeft size={15} />}
              {step === 0 ? 'Skip for now' : 'Back'}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} loading={busy}>
                Continue <ArrowRight size={15} />
              </Button>
            ) : (
              <Button onClick={finish} loading={busy}>
                Go to dashboard <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
