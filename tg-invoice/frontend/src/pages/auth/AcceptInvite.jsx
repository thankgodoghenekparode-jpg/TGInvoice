import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus, LogIn, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api, apiMessage, apiFieldErrors } from '../../services/api.js';
import AuthLayout from './AuthLayout.jsx';

/**
 * /accept-invitation?token=…
 * The invitation token is the credential (public endpoint). Two paths:
 *  - account already exists → must be signed in as that user
 *  - new user → create the account with name + password, signed in immediately
 */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const toast = useToast();
  const { user, refreshSession } = useAuth();

  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({ name: '', password: '', confirmPassword: '' });

  useEffect(() => {
    if (!token) {
      setLoadError('This invitation link is missing its token.');
      return;
    }
    api
      .get(`/team/invitations/${encodeURIComponent(token)}`)
      .then(({ data }) => setInvite(data.data))
      .catch((err) => setLoadError(apiMessage(err, 'This invitation is invalid or has expired.')));
  }, [token]);

  const accept = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post('/team/invitations/accept', { token, ...form });
      if (data.data.requiresLogin) {
        setBusy(false);
        toast.info(data.data.message || 'Sign in to accept this invitation.');
        return;
      }
      // Session cookie + access token are set — hydrate the app session.
      await refreshSession();
      toast.success(`You joined ${invite.businessName}.`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(apiMessage(err, 'Could not accept the invitation.'));
      setErrors(apiFieldErrors(err));
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthLayout title="Invitation" subtitle="Joining a business on TG Invoice.">
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {loadError}
        </div>
        <Link to="/login" className="btn btn-secondary mt-4 w-full">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  if (!invite) {
    return (
      <AuthLayout title="Invitation" subtitle="Joining a business on TG Invoice.">
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="size-7 animate-spin text-brand-600" />
          <p className="text-sm text-slate-500">Loading invitation…</p>
        </div>
      </AuthLayout>
    );
  }

  const needsSignIn = invite.accountExists && (!user || user.email.toLowerCase() !== invite.email.toLowerCase());

  return (
    <AuthLayout
      title={`Join ${invite.businessName}`}
      subtitle={`${invite.invitedBy} invited you to join as ${invite.role}.`}
    >
      <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50/50 p-3 text-sm">
        <p className="text-slate-500">Invitation for</p>
        <p className="font-medium text-slate-800">{invite.email}</p>
        <p className="mt-1 text-xs text-slate-400">
          Role: <span className="font-semibold uppercase">{invite.role}</span> · Expires{' '}
          {new Date(invite.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </div>

      {needsSignIn ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
            An account already exists for this email. Sign in as <strong>{invite.email}</strong> to accept.
          </div>
          <Link
            to="/login"
            state={{ from: `/accept-invitation?token=${encodeURIComponent(token)}` }}
            className="btn btn-primary w-full"
          >
            <LogIn size={16} /> Sign in to accept
          </Link>
        </div>
      ) : invite.requiresAccount ? (
        <form onSubmit={accept} className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Create your account to join — you’ll be signed in automatically.
          </div>
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input
              id="name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Your name"
              required
            />
            {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name}</p>}
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
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
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              required
            />
            {errors.confirmPassword && <p className="mt-1 text-xs text-rose-600">{errors.confirmPassword}</p>}
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            <UserPlus size={16} /> {busy ? 'Joining…' : `Join ${invite.businessName}`}
          </button>
        </form>
      ) : (
        <button type="button" className="btn btn-primary w-full" onClick={accept} disabled={busy}>
          <UserPlus size={16} /> {busy ? 'Joining…' : `Accept invitation`}
        </button>
      )}
    </AuthLayout>
  );
}
