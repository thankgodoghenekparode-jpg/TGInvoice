import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, apiMessage } from '../../services/api.js';
import AuthLayout from './AuthLayout.jsx';

/** Visits /verify-email?token=… (sent by email) and confirms server-side. */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState(token ? 'working' : 'invalid');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(({ data }) => {
        setMessage(data.data?.message || 'Email verified.');
        setState('done');
      })
      .catch((err) => {
        setMessage(apiMessage(err, 'This verification link is invalid or has expired.'));
        setState('error');
      });
  }, [token]);

  return (
    <AuthLayout title="Email verification" subtitle="Confirming your email address with TG Invoice.">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        {state === 'working' && (
          <>
            <Loader2 className="size-8 animate-spin text-brand-600" />
            <p className="text-sm text-slate-500">Verifying…</p>
          </>
        )}
        {state === 'done' && (
          <>
            <CheckCircle2 className="size-10 text-emerald-500" />
            <p className="font-medium text-slate-800">{message}</p>
            <Link to="/login" className="btn btn-primary mt-2">
              Continue to sign in
            </Link>
          </>
        )}
        {(state === 'error' || state === 'invalid') && (
          <>
            <AlertCircle className="size-10 text-rose-500" />
            <p className="text-sm text-slate-600">
              {message || 'This verification link is invalid or has expired.'}
            </p>
            <Link to="/login" className="btn btn-secondary mt-2">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
