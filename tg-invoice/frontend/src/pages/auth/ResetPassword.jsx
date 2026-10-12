import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Check } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { api, apiMessage, apiFieldErrors } from '../../services/api.js';
import AuthLayout from './AuthLayout.jsx';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({ password: '', confirmPassword: '' });

  const rules = [
    { ok: form.password.length >= 8, text: 'At least 8 characters' },
    { ok: /[A-Za-z]/.test(form.password), text: 'Contains a letter' },
    { ok: /[0-9]/.test(form.password), text: 'Contains a number' },
    { ok: form.password === form.confirmPassword && form.confirmPassword.length > 0, text: 'Passwords match' },
  ];

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post('/auth/reset-password', { token, ...form });
      toast.success(data.data?.message || 'Password updated.');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(apiMessage(err, 'Could not reset the password.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Invalid reset link" subtitle="This password reset link is incomplete.">
        <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
          The link is missing its token. Request a new password reset email.
        </div>
        <Link to="/forgot-password" className="btn btn-primary mt-4 w-full">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password you haven’t used before.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className="input"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          {errors.password && <p className="mt-1 text-xs text-rose-600">{errors.password}</p>}
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            className="input"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            required
          />
          {errors.confirmPassword && <p className="mt-1 text-xs text-rose-600">{errors.confirmPassword}</p>}
        </div>
        <ul className="grid grid-cols-2 gap-1 text-xs">
          {rules.map((r) => (
            <li key={r.text} className={`flex items-center gap-1.5 ${r.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
              <Check size={13} className={r.ok ? '' : 'opacity-30'} /> {r.text}
            </li>
          ))}
        </ul>
        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={busy || !rules.every((r) => r.ok)}
        >
          <KeyRound size={16} /> {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
