import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { apiMessage, apiFieldErrors } from '../../services/api.js';
import AuthLayout from './AuthLayout.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({ email: '', password: '' });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const data = await login(form);
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}.`);
      const dest =
        data.user.isPlatformAdmin && !data.activeTenant
          ? '/admin'
          : location.state?.from || '/dashboard';
      navigate(dest, { replace: true });
    } catch (err) {
      toast.error(apiMessage(err, 'Could not sign in.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in to your account"
      subtitle="Access your businesses, documents and reports."
      footer={
        <>
          New to TG Invoice?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@business.com"
            required
          />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">Password</label>
            <Link to="/forgot-password" className="mb-1.5 text-xs font-medium text-brand-600 hover:text-brand-700">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="input"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
            required
          />
          {errors.password && <p className="mt-1 text-xs text-rose-600">{errors.password}</p>}
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          <LogIn size={16} /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-xs text-slate-500">
        <p className="font-semibold text-slate-600">Demo credentials</p>
        <p className="mt-1">admin@zarox-energy.com · ChangeMe123!</p>
        <p>admin@abc-engineering.com · ChangeMe123!</p>
      </div>
    </AuthLayout>
  );
}
