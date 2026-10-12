import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import api from '../services/api.js';
import { Spinner } from './ui.jsx';
import { relativeTime } from '../utils/dates.js';

/**
 * NotificationBell — the in-app notification centre.
 *
 * Self-contained: polls the server every 30s and refreshes on tab focus, so
 * the unread badge stays sharp without a socket. The server owns the data
 * (GET /api/notifications); clicking a row marks it read and follows its
 * in-app `link`. Mount one per top bar.
 */

const POLL_MS = 30000;

const TONES = {
  TENANT_SUSPENDED: 'bg-rose-100 text-rose-600',
  ACCOUNT_SUSPENDED: 'bg-rose-100 text-rose-600',
  ACCESS_REVOKED: 'bg-rose-100 text-rose-600',
  PLATFORM_ADMIN_REVOKED: 'bg-rose-100 text-rose-600',
  ACCESS_GRANTED: 'bg-emerald-100 text-emerald-600',
  TENANT_ACTIVATED: 'bg-emerald-100 text-emerald-600',
  ACCOUNT_ACTIVATED: 'bg-emerald-100 text-emerald-600',
  PAYMENT_RECEIVED: 'bg-emerald-100 text-emerald-600',
  PLATFORM_ADMIN_GRANTED: 'bg-brand-100 text-brand-600',
  TEAM_MEMBER_JOINED: 'bg-brand-100 text-brand-600',
};

export default function NotificationBell({ className }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications', { params: { limit: 15 } });
      setItems(data.data || []);
      setUnread(data.meta?.unread ?? 0);
      setLoaded(true);
    } catch {
      /* ambient — never surface an error for a background poll */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setBusy(true);
      await load();
      setBusy(false);
    }
  };

  const markAll = async () => {
    const stamp = new Date().toISOString();
    setUnread(0);
    setItems((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: stamp })));
    try {
      await api.post('/notifications/read-all');
    } catch {
      load();
    }
  };

  const openItem = (n) => {
    setOpen(false);
    if (!n.readAt) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api.post(`/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:scale-95"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex min-w-[17px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-[17px] text-white ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[340px] max-w-[calc(100vw-1.5rem)] origin-top-right animate-scale-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-[13px] font-semibold text-slate-800">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 transition hover:text-brand-700"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {busy && !loaded ? (
              <div className="p-6">
                <Spinner className="mx-auto size-5" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
                <Inbox className="size-7 text-slate-300" />
                <p className="text-[13px] text-slate-400">You&rsquo;re all caught up.</p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={clsx(
                    'flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50',
                    !n.readAt && 'bg-brand-50/40'
                  )}
                >
                  <span className={clsx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', TONES[n.type] || 'bg-slate-100 text-slate-500')}>
                    <Bell className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-slate-800">{n.title}</span>
                      {!n.readAt && <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-500" />}
                    </span>
                    {n.body && <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-slate-400">
                      {n.tenant?.name ? `${n.tenant.name} · ` : ''}
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
