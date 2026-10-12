import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, KeyRound, ShieldCheck, CheckCircle2 } from 'lucide-react';
import api, { apiMessage, apiFieldErrors } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Field, Button, Badge } from '../../components/ui.jsx';

export default function ProfileSettingsPage() {
  const toast = useToast();
  const { user, role, setUser } = useAuth();

  const [profile, setProfile] = useState({ name: '', email: '' });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErrors, setProfileErrors] = useState({});

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErrors, setPwErrors] = useState({});
  const [pwDone, setPwDone] = useState('');

  useEffect(() => {
    if (user) setProfile({ name: user.name || '', email: user.email || '' });
  }, [user]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileErrors({});
    try {
      const { data } = await api.put('/auth/me', profile);
      setUser(data.data.user);
      toast.success('Profile updated.');
      if (data.data.user?.email !== user?.email) {
        toast.info('Verify your new email address from the link we sent.', 'Email changed');
      }
    } catch (err) {
      toast.error(apiMessage(err, 'Could not update your profile.'));
      setProfileErrors(apiFieldErrors(err));
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwBusy(true);
    setPwErrors({});
    setPwDone('');
    if (pw.newPassword !== pw.confirmPassword) {
      setPwErrors({ confirmPassword: 'Passwords do not match.' });
      setPwBusy(false);
      return;
    }
    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwDone(data.data.message);
      toast.success('Password changed.');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not change your password.'));
      setPwErrors(apiFieldErrors(err));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Your profile"
        subtitle="Your personal account — shared across every business you belong to."
        actions={
          <Link to="/settings" className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} /> Settings
          </Link>
        }
      />

      {/* Identity */}
      <div className="card-blue mb-5 flex flex-wrap items-center gap-4 p-6">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-xl font-bold text-brand-700 ring-1 ring-brand-100">
          {(user?.name || '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {user?.name}
            {user?.emailVerified ? (
              <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                <ShieldCheck size={12} className="mr-1" /> Verified
              </Badge>
            ) : (
              <Badge className="bg-amber-50 text-amber-700 ring-amber-200">Unverified email</Badge>
            )}
          </p>
          <p className="truncate text-sm text-slate-500">{user?.email}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Role in this business</p>
          <p className="font-semibold text-slate-700">{role || '—'}</p>
        </div>
      </div>

      {/* Profile form */}
      <form onSubmit={saveProfile} className="card mb-5 space-y-5 p-6">
        <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Name and email</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" required error={profileErrors.name}>
            <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />
          </Field>
          <Field label="Email address" required error={profileErrors.email} hint="Changing your email requires re-verification.">
            <input type="email" className="input" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} required />
          </Field>
        </div>
        <div className="flex justify-end border-t border-slate-100 pt-5">
          <Button type="submit" loading={profileBusy}>
            <Save size={15} /> Save profile
          </Button>
        </div>
      </form>

      {/* Password form */}
      <form onSubmit={changePassword} className="card space-y-5 p-6">
        <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Changing your password signs out every other session.
          </p>
        </div>

        {pwDone && (
          <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 size={16} /> {pwDone}
          </p>
        )}

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Current password" required error={pwErrors.currentPassword}>
            <input
              type="password"
              autoComplete="current-password"
              className="input"
              value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
              required
            />
          </Field>
          <Field label="New password" required error={pwErrors.newPassword} hint="8+ chars, a letter and a number.">
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
              required
            />
          </Field>
          <Field label="Confirm new password" required error={pwErrors.confirmPassword}>
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              value={pw.confirmPassword}
              onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })}
              required
            />
          </Field>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-5">
          <Button type="submit" loading={pwBusy}>
            <KeyRound size={15} /> Change password
          </Button>
        </div>
      </form>
    </div>
  );
}
