import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, MailCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { api, apiMessage } from '../../services/api.js';
import AuthLayout from './AuthLayout.jsx';

export default function ForgotPasswordPage() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setSent(true);
      toast.success(data.data?.message || 'Check your inbox for a reset link.');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not send the reset link.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We’ll email you a secure link to set a new password."
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Back to sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="flex items-center gap-2 font-semibold">
            <MailCheck size={16} /> Check your inbox
          </p>
          <p className="mt-1.5">
            If an account exists for <strong>{email}</strong>, a reset link is on its way. The link expires shortly
            for security.
          </p>
          <p className="mt-3 text-xs text-emerald-600">
            Didn’t get it? Check spam, or{' '}
            <button type="button" className="underline" onClick={() => setSent(false)}>
              try again
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            <Send size={16} /> {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
