import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiMessage, apiFieldErrors } from '../../services/api.js';
import { CURRENCY_PRESETS } from '../../utils/currency.js';
import AuthLayout from './AuthLayout.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    business: { name: '', phone: '', country: 'Nigeria', currency: 'NGN' },
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setBusiness = (patch) => setForm((f) => ({ ...f, business: { ...f.business, ...patch } }));

  const rules = [
    { ok: form.password.length >= 8, text: 'At least 8 characters' },
    { ok: /[A-Za-z]/.test(form.password), text: 'Contains a letter' },
    { ok: /[0-9]/.test(form.password), text: 'Contains a number' },
    { ok: form.password === form.confirmPassword && form.confirmPassword.length > 0, text: 'Passwords match' },
  ];
  const valid = rules.every((r) => r.ok) && form.name.trim().length >= 2 && form.business.name.trim().length >= 2;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const preset = CURRENCY_PRESETS.find((c) => c.code === form.business.currency) || CURRENCY_PRESETS[0];
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        confirmPassword: form.confirmPassword,
        business: {
          name: form.business.name.trim(),
          phone: form.business.phone,
          country: form.business.country,
          currency: { code: preset.code, symbol: preset.symbol, position: 'prefix' },
        },
      });
      toast.success('Account created. Let’s set up your business.');
      navigate('/onboarding', { replace: true });
    } catch (err) {
      toast.error(apiMessage(err, 'Could not create the account.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start invoicing in minutes — your first business is free."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">Your full name</label>
          <input
            id="name"
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Ada Obi"
            required
          />
          {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name}</p>}
        </div>
        <div>
          <label className="label" htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="you@business.com"
            required
          />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email}</p>}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="text-[13px] font-semibold text-slate-700">Your first business</p>
          <p className="mb-3 text-xs text-slate-400">You can add more businesses later from the switcher.</p>
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="business">Business name</label>
              <input
                id="business"
                className="input"
                value={form.business.name}
                onChange={(e) => setBusiness({ name: e.target.value })}
                placeholder="e.g. Acme Studios Ltd"
                required
              />
              {errors['business.name'] && <p className="mt-1 text-xs text-rose-600">{errors['business.name']}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="phone">Business phone (optional)</label>
                <input
                  id="phone"
                  className="input"
                  value={form.business.phone}
                  onChange={(e) => setBusiness({ phone: e.target.value })}
                  placeholder="+234 801 234 5678"
                />
              </div>
              <div>
                <label className="label" htmlFor="currency">Currency</label>
                <select
                  id="currency"
                  className="input"
                  value={form.business.currency}
                  onChange={(e) => setBusiness({ currency: e.target.value })}
                >
                  {CURRENCY_PRESETS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="grid gap-4">
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="input"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder="••••••••"
                required
              />
              {errors.password && <p className="mt-1 text-xs text-rose-600">{errors.password}</p>}
            </div>
            <div>
              <label className="label" htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className="input"
                value={form.confirmPassword}
                onChange={(e) => set({ confirmPassword: e.target.value })}
                placeholder="••••••••"
                required
              />
              {errors.confirmPassword && <p className="mt-1 text-xs text-rose-600">{errors.confirmPassword}</p>}
            </div>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-1 text-xs">
            {rules.map((r) => (
              <li key={r.text} className={`flex items-center gap-1.5 ${r.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
                <Check size={13} className={r.ok ? '' : 'opacity-30'} /> {r.text}
              </li>
            ))}
          </ul>
        </div>

        <button type="submit" className="btn btn-primary w-full" disabled={busy || !valid}>
          <UserPlus size={16} /> {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
