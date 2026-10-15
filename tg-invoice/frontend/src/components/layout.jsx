import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, FileText, Users, Package, BarChart3, Settings as SettingsIcon,
  UserRound, LogOut, ChevronDown, Plus, Search, Menu, X, Building2, Download, ShieldCheck, Gift,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api, { apiMessage } from '../services/api';
import { Button, Field, Modal, Select, Spinner } from './ui';
import NotificationBell from './notifications';
import { CURRENCY_PRESETS } from '../utils/currency';
import { useToast } from '../context/ToastContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Documents', icon: FileText, children: [
    { to: '/quotations', label: 'Quotations' },
    { to: '/invoices', label: 'Invoices' },
    { to: '/recurring', label: 'Recurring' },
    { to: '/receipts', label: 'Receipts' },
    { to: '/credit-notes', label: 'Credit notes' },
    { to: '/refunds', label: 'Refunds' },
  ] },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/products', label: 'Products & Services', icon: Package },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/referrals', label: 'Referrals', icon: Gift },
  { to: '/team', label: 'Team', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

/* Primary destinations for the mobile bottom tab bar. */
const MOBILE_TABS = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
];

/* ── Install app (PWA) ────────────────────────────────────────────── */

function InstallAppButton() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const toast = useToast();
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await promptInstall();
        if (ok) toast.success('TG Invoice installed. Open it any time from your home screen.');
      }}
      className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-[13px] font-medium text-white transition-all duration-200 hover:bg-white/20 active:scale-[0.98]"
    >
      <Download className="size-4" /> Install app
    </button>
  );
}

/* ── Mobile bottom tab bar ────────────────────────────────────────── */

function MobileTabBar({ onMore }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_-12px_rgba(15,23,42,0.25)] backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {MOBILE_TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className="group relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium">
            {({ isActive }) => (
              <>
                <span
                  className={clsx(
                    'absolute inset-x-6 top-0 h-[3px] rounded-b-full transition-all duration-300',
                    isActive ? 'bg-brand-600' : 'bg-transparent'
                  )}
                />
                <tab.icon
                  className={clsx(
                    'size-[22px] transition-transform duration-200 group-active:scale-90',
                    isActive ? 'text-brand-600' : 'text-slate-400'
                  )}
                />
                <span className={isActive ? 'text-brand-700' : 'text-slate-500'}>{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMore}
          className="group flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium text-slate-500"
        >
          <Menu className="size-[22px] text-slate-400 transition-transform duration-200 group-active:scale-90" />
          More
        </button>
      </div>
    </nav>
  );
}


/* ── Sidebar ──────────────────────────────────────────────────────── */

function SidebarNav({ onNavigate }) {
  const { user, role } = useAuth();
  // The referral programme is owner/admin-only, so staff don't see a door
  // they cannot open (the server enforces it regardless).
  const canSeeReferrals = role === 'OWNER' || role === 'ADMIN';
  const base = canSeeReferrals ? NAV : NAV.filter((item) => item.to !== '/referrals');
  const items = user?.isPlatformAdmin
    ? [...base, { to: '/admin', label: 'Platform Admin', icon: ShieldCheck }]
    : base;
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {items.map((item, i) =>
        item.children ? (
          <div key={item.label} className="animate-fade-in pt-1" style={{ animationDelay: `${i * 45}ms` }}>
            <p className="flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-brand-200/90">
              <item.icon className="size-4" />
              {item.label}
            </p>
            <div className="ml-3 space-y-0.5 border-l border-white/20 pl-3">
              {item.children.map((child) => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      'group flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13.5px] transition-all duration-200',
                      isActive
                        ? 'bg-white font-medium text-brand-700 shadow-md shadow-brand-900/20'
                        : 'text-brand-100/80 hover:translate-x-0.5 hover:bg-white/10 hover:text-white'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={clsx(
                          'size-1.5 rounded-full transition-all duration-200',
                          isActive ? 'bg-brand-500' : 'bg-white/25 group-hover:bg-white/70'
                        )}
                      />
                      {child.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            style={{ animationDelay: `${i * 45}ms` }}
            className={({ isActive }) =>
              clsx(
                'group flex animate-fade-in items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                isActive
                  ? 'bg-white font-medium text-brand-700 shadow-md shadow-brand-900/20'
                  : 'text-brand-100/80 hover:translate-x-0.5 hover:bg-white/10 hover:text-white'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={clsx('size-5 transition-transform duration-200 group-hover:scale-110', isActive && 'text-brand-600')} />
                {item.label}
              </>
            )}
          </NavLink>
        )
      )}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 border-b border-white/15 px-5 py-4">
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-white to-brand-100 text-sm font-bold text-brand-700 shadow-lg shadow-brand-900/30 ring-1 ring-white/40">
        TG
      </div>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight text-white">TG Invoice</p>
        <p className="text-[11px] font-medium tracking-wide text-brand-200">by tgeasy</p>
      </div>
    </div>
  );
}

/* ── Business switcher ────────────────────────────────────────────── */

function BusinessSwitcher({ compact = false, tone = 'light' }) {
  const dark = tone === 'dark';
  const { tenants, activeTenant, switchTenant, addTenant } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', country: 'Nigeria', currency: 'NGN' });
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const doSwitch = async (id) => {
    if (id === activeTenant?.id) return;
    setOpen(false);
    try {
      await switchTenant(id);
      toast.success('Business switched. All data now belongs to the selected business.');
      navigate('/dashboard');
      window.location.reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not switch business.'));
    }
  };

  const createBusiness = async () => {
    if (form.name.trim().length < 2) return toast.error('Enter a business name.');
    setBusy(true);
    try {
      const preset = CURRENCY_PRESETS.find((c) => c.code === form.currency) || CURRENCY_PRESETS[0];
      const { data } = await api.post('/tenants', {
        name: form.name.trim(),
        phone: form.phone,
        email: form.email,
        country: form.country,
        currency: { code: preset.code, symbol: preset.symbol, position: 'prefix' },
      });
      addTenant({ ...data.data, logo: null });
      toast.success(`${data.data.name} created.`);
      setCreating(false);
      setForm({ name: '', phone: '', email: '', country: 'Nigeria', currency: 'NGN' });
      window.location.href = '/onboarding';
    } catch (err) {
      toast.error(apiMessage(err, 'Could not create the business.'));
    } finally {
      setBusy(false);
    }
  };

  if (!activeTenant) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-200 active:scale-[0.99]',
          dark
            ? 'border-white/20 bg-white/10 hover:border-white/35 hover:bg-white/15'
            : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/40',
          compact && 'justify-center px-2'
        )}
      >
        {activeTenant.logo ? (
          <img src={activeTenant.logo} alt="" className="size-7 rounded-md object-cover ring-1 ring-white/20" />
        ) : (
          <span
            className={clsx(
              'flex size-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold',
              dark ? 'bg-white/20 text-white ring-1 ring-white/25' : 'bg-brand-50 text-brand-700'
            )}
          >
            {activeTenant.name?.[0]?.toUpperCase() || 'B'}
          </span>
        )}
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className={clsx('block truncate text-[13px] font-medium', dark ? 'text-white' : 'text-slate-800')}>{activeTenant.name}</span>
              <span className={clsx('block text-[11px]', dark ? 'text-brand-200' : 'text-slate-400')}>Current business</span>
            </span>
            <ChevronDown className={clsx('size-4 shrink-0', dark ? 'text-brand-200' : 'text-slate-400')} />
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-72 max-w-[85vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Switch business</p>
          <div className="mt-1 max-h-72 overflow-y-auto p-1.5">
            {tenants.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => doSwitch(t.id)}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition',
                  t.id === activeTenant.id ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                <Building2 className="size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-[10px] font-medium uppercase text-slate-400">{t.role}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            className="flex w-full items-center gap-2 border-t border-slate-200 px-4 py-2.5 text-[13px] font-medium text-brand-700 hover:bg-brand-50"
          >
            <Plus className="size-4" /> Create new business
          </button>
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create a new business"
        description="Each business is a separate, fully isolated workspace."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button onClick={createBusiness} loading={busy}>Create business</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Business name" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Studios Ltd" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Business phone">
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234 801 234 5678" />
            </Field>
            <Field label="Business email">
              <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="billing@business.com" />
            </Field>
            <Field label="Country">
              <input className="input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCY_PRESETS.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol})</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Global search ────────────────────────────────────────────────── */

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/search', { params: { q: term } });
        setResults(data.data);
        setOpen(true);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (path) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };

  const groups = results
    ? [
        { key: 'customers', label: 'Customers', rows: results.customers, render: (c) => ({ title: c.companyName || c.name, sub: `${c.customerCode} · ${c.phone || c.email || ''}`, to: `/customers/${c.id}` }) },
        { key: 'invoices', label: 'Invoices', rows: results.invoices, render: (i) => ({ title: i.invoiceNumber, sub: `${i.customer?.name || ''} · ${i.status}`, to: `/invoices/${i.id}` }) },
        { key: 'quotations', label: 'Quotations', rows: results.quotations, render: (x) => ({ title: x.quotationNumber, sub: `${x.customer?.name || ''} · ${x.status}`, to: `/quotations/${x.id}` }) },
        { key: 'receipts', label: 'Receipts', rows: results.receipts, render: (r) => ({ title: r.receiptNumber, sub: `${r.customer?.name || ''}`, to: `/receipts/${r.id}` }) },
      ].filter((g) => g.rows?.length)
    : [];

  return (
    <div className="relative w-full max-w-md" ref={boxRef}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder="Search customers, invoices, quotations…"
        className="input pl-9 pr-8"
      />
      {loading && <Spinner className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2" />}
      {open && groups.length > 0 && (
        <div className="absolute left-0 top-full z-40 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {groups.map((g) => (
            <div key={g.key} className="mb-1">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
              {g.rows.map((row) => {
                const view = g.render(row);
                return (
                  <button key={row.id} type="button" onClick={() => go(view.to)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">{view.title}</span>
                      <span className="block truncate text-xs text-slate-400">{view.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && !loading && groups.length === 0 && (
        <div className="absolute left-0 top-full z-40 mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-xl">
          No matches in this business.
        </div>
      )}
    </div>
  );
}

/* ── User footer (sidebar bottom) ─────────────────────────────────── */

function UserFooter({ onNavigate }) {
  const { user, activeTenant, role, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  return (
    <div className="border-t border-white/15 p-3">
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-[12px] font-semibold text-white ring-1 ring-white/25">
          {user?.name?.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-white">{user?.name}</span>
          <span className="block truncate text-[11px] text-brand-200">{activeTenant?.name}{role ? ` · ${role}` : ''}</span>
        </span>
        <button
          type="button"
          title="Log out"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await logout();
            setBusy(false);
          }}
          className="rounded-lg p-1.5 text-brand-200 transition-all duration-200 hover:bg-white/10 hover:text-rose-300 active:scale-90 disabled:opacity-50"
        >
          {busy ? <Spinner className="size-4" /> : <LogOut className="size-4" />}
        </button>
      </div>
      <button
        type="button"
        onClick={() => { onNavigate?.(); window.location.href = '/settings/profile'; }}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[13px] font-medium text-white transition-all duration-200 hover:bg-white/20 active:scale-[0.98]"
      >
        <SettingsIcon className="size-4" /> Manage account
      </button>
    </div>
  );
}

/* ── App shell ────────────────────────────────────────────────────── */

export default function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { activeTenant } = useAuth();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const sidebar = (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-brand-600 via-brand-700 to-brand-800">
      {/* Ambient glows give the blue depth instead of feeling flat. */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-white/10 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -left-24 bottom-24 size-64 rounded-full bg-sky-400/15 blur-3xl" />
      <Brand />
      <SidebarNav onNavigate={() => setMobileOpen(false)} />
      <div className="px-3 pb-3">
        <BusinessSwitcher tone="dark" />
      </div>
      <InstallAppButton />
      <UserFooter onNavigate={() => setMobileOpen(false)} />
    </div>
  );

  return (
    <div className="min-h-[100dvh]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-brand-900/20 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-fade-in border-r border-brand-900/20 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <button type="button" onClick={() => setMobileOpen(false)} className="absolute right-3 top-[calc(1rem+env(safe-area-inset-top))] z-10 rounded-lg p-1 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-brand-100/70 bg-white/80 pt-[env(safe-area-inset-top)] shadow-sm shadow-slate-900/[0.03] backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 text-slate-500 transition-transform hover:bg-slate-100 active:scale-90 lg:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <div className="lg:hidden">
              <BusinessSwitcher compact />
            </div>
            <div className="hidden flex-1 lg:block">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="max-w-[45vw] truncate text-[13px] font-medium text-slate-600 lg:hidden">{activeTenant?.name}</span>
              <NotificationBell />
            </div>
          </div>
        </header>

        {/* `key` re-triggers the entrance animation on every route change. */}
        <main key={location.pathname} className="mx-auto w-full max-w-[1400px] animate-fade-up px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:pb-8">
          {children ?? <Outlet />}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <MobileTabBar onMore={() => setMobileOpen(true)} />
    </div>
  );
}

export { BusinessSwitcher, GlobalSearch };
