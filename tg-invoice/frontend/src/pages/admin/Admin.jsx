import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ShieldCheck, Building2, Users as UsersIcon, FileText, Banknote,
  ArrowLeft, LogOut, Search, RefreshCw, Mail, CheckCircle2, AlertCircle,
  LayoutDashboard, Menu, X, Plus, Ban, Power, Trash2, UserPlus, KeyRound, Copy, Handshake,
} from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import NotificationBell from '../../components/notifications.jsx';
import {
  Button, Badge, StatCard, Spinner, EmptyState, Pagination, LoadingBlock,
  Modal, ConfirmDialog, Field, Select,
  th, td, trHover,
} from '../../components/ui.jsx';
import { formatCompact, CURRENCY_PRESETS } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';
import GrowthPanel from './Growth.jsx';

/**
 * Platform administration (super-admin).
 *
 * Standalone surface — deliberately OUTSIDE the tenant AppShell, because a
 * platform operator oversees every business without belonging to one. The
 * server gates every call with requirePlatformAdmin.
 */

const money = (value, symbol = '₦') => formatCompact(value, { currencySymbol: symbol });

const ROLE_BADGE = {
  OWNER: 'bg-brand-50 text-brand-700 ring-brand-200',
  ADMIN: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  STAFF: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', STAFF: 'Staff' };

const initials = (name) =>
  (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

const VIEW_META = {
  overview: {
    title: 'Platform overview',
    desc: 'Every business on TG Invoice. Read-only oversight of documents — businesses and accounts are managed here.',
  },
  tenants: {
    title: 'Businesses',
    desc: 'Register, suspend and control access for every business on the platform.',
  },
  users: {
    title: 'Platform admins',
    desc: 'Users of the super-admin platform — the operators who can manage every business. Tenant staff are managed by each business\u2019s own admins.',
  },
  growth: {
    title: 'Growth',
    desc: 'Reseller, accountant and affiliate partners, plus every business referred into the platform and the rewards credited to them.',
  },
};

function StatusPill({ status }) {
  const active = status === 'ACTIVE';
  return (
    <Badge className={active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}>
      {active ? 'Active' : 'Suspended'}
    </Badge>
  );
}

export default function AdminPage() {
  const { user, tenants, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [view, setView] = useState('overview');
  const [mobileOpen, setMobileOpen] = useState(false);

  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ view: 'tenants', rows: [], meta: null });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [listVersion, setListVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Write actions
  const [createOpen, setCreateOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [manage, setManage] = useState(null); // tenant detail for the access modal
  const [manageLoading, setManageLoading] = useState(false);
  const [confirm, setConfirm] = useState(null); // { title, message, confirmLabel, danger, run }
  const [busyId, setBusyId] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await api.get('/admin/overview');
      setOverview(data.data);
      setOverviewError('');
    } catch (err) {
      setOverviewError(apiMessage(err, 'Could not load platform statistics.'));
    } finally {
      setOverviewLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Directory data — only fetched for the Businesses / Users views.
  useEffect(() => {
    if (view !== 'tenants' && view !== 'users') return undefined;
    let cancelled = false;
    setListLoading(true);
    const requestedView = view;
    const endpoint = requestedView === 'tenants' ? '/admin/tenants' : '/admin/users';
    const timer = setTimeout(() => {
      api
        .get(endpoint, { params: { page, limit: 12, q: q || undefined } })
        .then(({ data }) => {
          if (!cancelled) {
            setList({ view: requestedView, rows: data.data || [], meta: data.meta || null });
            setListError('');
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setList({ view: requestedView, rows: [], meta: null });
            setListError(apiMessage(err, 'Could not load the list.'));
          }
        })
        .finally(() => {
          if (!cancelled) setListLoading(false);
        });
    }, q ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, page, q, listVersion]);

  const changeView = (value) => {
    setView(value);
    setPage(1);
    setQ('');
    setMobileOpen(false);
  };

  const refreshAll = () => {
    loadOverview();
    if (view === 'tenants' || view === 'users') setListVersion((v) => v + 1);
  };

  /** Run a write action, then refresh stats + the current list. */
  const runAction = async (fn, successMsg, rowId = null) => {
    setBusyId(rowId);
    setActionBusy(true);
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
      loadOverview();
      if (view === 'tenants' || view === 'users') setListVersion((v) => v + 1);
      return true;
    } catch (err) {
      toast.error(apiMessage(err, 'That action could not be completed.'));
      return false;
    } finally {
      setBusyId(null);
      setActionBusy(false);
    }
  };

  const askConfirm = (options) => setConfirm(options);

  const confirmNow = async () => {
    if (!confirm) return;
    const done = await confirm.run();
    if (done !== false) setConfirm(null);
  };

  /* ── Business actions ───────────────────────────────────────────── */

  const openManage = async (tenant) => {
    setManage({ id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, members: [], counts: tenant.counts, loading: true });
    setManageLoading(true);
    try {
      const { data } = await api.get(`/admin/tenants/${tenant.id}`);
      setManage(data.data);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not load the business.'));
      setManage(null);
    } finally {
      setManageLoading(false);
    }
  };

  const reloadManage = async (tenantId) => {
    try {
      const { data } = await api.get(`/admin/tenants/${tenantId}`);
      setManage(data.data);
    } catch {
      /* keep the previous view */
    }
  };

  const grantMember = async (tenantId, payload) => {
    await api.post(`/admin/tenants/${tenantId}/members`, payload);
    toast.success('Access granted.');
    await reloadManage(tenantId);
    setListVersion((v) => v + 1);
  };

  const revokeMember = (tenantId, member) => {
    askConfirm({
      title: 'Revoke access?',
      message: `${member.user.name} (${member.user.email}) will lose access to this business immediately.`,
      confirmLabel: 'Revoke access',
      danger: true,
      run: () =>
        runAction(
          () => api.delete(`/admin/tenants/${tenantId}/members/${member.user.id}`),
          'Access revoked.'
        ).then(async (ok) => {
          if (ok) await reloadManage(tenantId);
          return ok;
        }),
    });
  };

  /* ── Account actions ────────────────────────────────────────────── */

  const toggleUserStatus = (u) => {
    const suspending = u.status === 'ACTIVE';
    askConfirm({
      title: suspending ? 'Suspend account?' : 'Reactivate account?',
      message: suspending
        ? `${u.name} (${u.email}) will be signed out everywhere and blocked from signing in until reactivated.`
        : `${u.name} (${u.email}) will be able to sign in again.`,
      confirmLabel: suspending ? 'Suspend account' : 'Reactivate',
      danger: suspending,
      run: () =>
        runAction(
          () => api.post(`/admin/users/${u.id}/${suspending ? 'suspend' : 'activate'}`),
          suspending ? 'Account suspended.' : 'Account reactivated.',
          u.id
        ),
    });
  };

  const togglePlatformAdmin = (u) => {
    const grant = !u.isPlatformAdmin;
    askConfirm({
      title: grant ? 'Grant platform-admin access?' : 'Revoke platform-admin access?',
      message: grant
        ? `${u.name} (${u.email}) will be able to see and manage EVERY business on the platform. Grant this only to trusted operators.`
        : `${u.name} (${u.email}) will lose access to the platform administration area.`,
      confirmLabel: grant ? 'Grant access' : 'Revoke access',
      danger: !grant,
      run: () =>
        runAction(
          () => api.patch(`/admin/users/${u.id}/platform-admin`, { isPlatformAdmin: grant }),
          grant ? 'Platform-admin access granted.' : 'Platform-admin access revoked.',
          u.id
        ),
    });
  };

  const counts = overview?.counts;
  const moneyStats = overview?.money;

  // Only ever show rows that belong to the active view.
  const rows = list.view === view ? list.rows : [];
  const meta = list.view === view ? list.meta : null;
  const panelLoading = listLoading || list.view !== view;

  const kpis = useMemo(
    () => [
      { label: 'Businesses', value: counts?.tenants ?? '—', sub: overview ? `${overview.growth.tenants30d} new · ${counts?.suspendedTenants ?? 0} suspended` : '', icon: Building2, tone: 'brand' },
      { label: 'Tenant admins', value: counts?.tenantAdmins ?? '—', sub: 'owners & admins across businesses', icon: UsersIcon, tone: 'sky' },
      { label: 'Platform admins', value: counts?.platformAdmins ?? '—', sub: 'operators of this platform', icon: ShieldCheck, tone: 'default' },
      { label: 'Invoices', value: counts?.invoices ?? '—', sub: `${counts?.quotations ?? 0} quotations`, icon: FileText, tone: 'default' },
      { label: 'Invoiced', value: moneyStats ? money(moneyStats.invoiced) : '—', sub: 'combined business currencies', icon: FileText, tone: 'green' },
      { label: 'Collected', value: moneyStats ? money(moneyStats.collected) : '—', sub: `${counts?.payments ?? 0} payments`, icon: Banknote, tone: 'sky' },
      { label: 'Outstanding', value: moneyStats ? money(moneyStats.outstanding) : '—', sub: 'unpaid across businesses', icon: AlertCircle, tone: 'amber' },
    ],
    [counts, moneyStats, overview]
  );

  const NAV = [
    { value: 'overview', label: 'Overview', icon: LayoutDashboard },
    { value: 'tenants', label: 'Businesses', icon: Building2, count: counts?.tenants },
    { value: 'growth', label: 'Growth', icon: Handshake },
    { value: 'users', label: 'Platform admins', icon: ShieldCheck, count: counts?.platformAdmins },
  ];

  const metaTitle = VIEW_META[view];

  const sidebar = (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-brand-600 via-brand-700 to-brand-800">
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-white/10 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -left-24 bottom-24 size-64 rounded-full bg-sky-400/15 blur-3xl" />

      <div className="flex items-center gap-2.5 border-b border-white/15 px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white to-brand-100 text-sm font-bold text-brand-700 shadow-lg shadow-brand-900/30 ring-1 ring-white/40">
          TG
        </div>
        <div className="min-w-0 leading-tight">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-white">
            Platform Admin
            <ShieldCheck className="size-4 shrink-0 text-brand-200" />
          </p>
          <p className="truncate text-[11px] font-medium tracking-wide text-brand-200">TG Invoice · by tgeasy</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV.map((item) => {
          const active = view === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => changeView(item.value)}
              className={clsx(
                'group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                active
                  ? 'bg-white font-medium text-brand-700 shadow-md shadow-brand-900/20'
                  : 'text-brand-100/80 hover:translate-x-0.5 hover:bg-white/10 hover:text-white'
              )}
            >
              <item.icon className={clsx('size-5 transition-transform duration-200 group-hover:scale-110', active && 'text-brand-600')} />
              <span className="min-w-0 flex-1 text-left">{item.label}</span>
              {typeof item.count === 'number' && (
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                    active ? 'bg-brand-100 text-brand-700' : 'bg-white/15 text-brand-100'
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/15 p-3">
        {tenants.length > 0 && (
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[13px] font-medium text-white transition-all duration-200 hover:bg-white/20 active:scale-[0.98]"
          >
            <ArrowLeft className="size-4" /> Back to app
          </button>
        )}
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-[12px] font-semibold text-white ring-1 ring-white/25">
            {initials(user?.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">{user?.name}</span>
            <span className="block truncate text-[11px] text-brand-200">Platform super-admin</span>
          </span>
          <button
            type="button"
            title="Sign out"
            onClick={logout}
            className="rounded-lg p-1.5 text-brand-200 transition-all duration-200 hover:bg-white/10 hover:text-rose-300 active:scale-90"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-brand-900/20 lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-fade-in border-r border-brand-900/20 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-[calc(1rem+env(safe-area-inset-top))] z-10 rounded-lg p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-brand-100/70 bg-white/80 pt-[env(safe-area-inset-top)] shadow-sm shadow-slate-900/[0.03] backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-slate-500 transition-transform hover:bg-slate-100 active:scale-90 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{metaTitle.title}</h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <NotificationBell />
              <Button variant="secondary" size="sm" onClick={refreshAll} disabled={refreshing}>
                <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} /> Refresh
              </Button>
            </div>
          </div>
        </header>

        <main key={view} className="mx-auto w-full max-w-[1400px] animate-fade-up px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-[13px] text-slate-500">{metaTitle.desc}</p>
            {view === 'tenants' && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> New business
              </Button>
            )}
            {view === 'users' && (
              <Button size="sm" onClick={() => setAddUserOpen(true)}>
                <UserPlus className="size-4" /> Add platform user
              </Button>
            )}
          </div>

          {overviewError && (
            <div className="mb-5 mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{overviewError}</span>
            </div>
          )}

          {view === 'overview' && (
            overviewLoading && !overview ? (
              <div className="mt-5">
                <LoadingBlock label="Loading platform statistics…" />
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {kpis.map((k) => (
                  <StatCard key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} tone={k.tone} />
                ))}
              </div>
            )
          )}

          {(view === 'tenants' || view === 'users') && (
            <div className="mt-4 card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
                <div className="relative min-w-0 flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(1);
                    }}
                    placeholder={view === 'tenants' ? 'Search businesses…' : 'Search platform admins…'}
                    className="input pl-9"
                  />
                </div>
                {listLoading && <Spinner className="size-4" />}
                <p className="ml-auto text-[13px] text-slate-400">
                  {meta ? `${meta.total.toLocaleString()} ${view === 'tenants' ? 'businesses' : 'platform admins'}` : ''}
                </p>
              </div>

              {listError ? (
                <div className="flex items-start gap-2 px-5 py-6 text-[13px] text-rose-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>{listError}</span>
                </div>
              ) : view === 'tenants' ? (
                <TenantsPanel
                  rows={rows}
                  loading={panelLoading}
                  busyId={busyId}
                  onManage={openManage}
                  onSuspend={(t) =>
                    askConfirm({
                      title: 'Suspend business?',
                      message: `Every member of ${t.name} will immediately lose access until you reactivate it. Their data is kept intact.`,
                      confirmLabel: 'Suspend business',
                      danger: true,
                      run: () => runAction(() => api.post(`/admin/tenants/${t.id}/suspend`), `${t.name} suspended.`, t.id),
                    })
                  }
                  onActivate={(t) =>
                    runAction(() => api.post(`/admin/tenants/${t.id}/activate`), `${t.name} reactivated.`, t.id)
                  }
                />
              ) : (
                <UsersPanel
                  rows={rows}
                  loading={panelLoading}
                  busyId={busyId}
                  currentUserId={user?.id}
                  onToggleStatus={toggleUserStatus}
                  onTogglePlatformAdmin={togglePlatformAdmin}
                />
              )}

              {meta && !listError && (
                <Pagination
                  page={meta.page}
                  totalPages={meta.totalPages}
                  total={meta.total}
                  onPage={setPage}
                  label={view === 'tenants' ? 'businesses' : 'platform admins'}
                />
              )}
            </div>
          )}

          {view === 'growth' && <GrowthPanel onRefreshOverview={loadOverview} />}
        </main>
      </div>

      <CreateBusinessModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          loadOverview();
          setListVersion((v) => v + 1);
        }}
      />

      <AddPlatformUserModal
        open={addUserOpen}
        onClose={() => setAddUserOpen(false)}
        onAdded={() => {
          loadOverview();
          setListVersion((v) => v + 1);
        }}
      />

      <ManageAccessModal
        tenant={manage}
        loading={manageLoading}
        busyId={busyId}
        onClose={() => setManage(null)}
        onGrant={grantMember}
        onRevoke={revokeMember}
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => (actionBusy ? null : setConfirm(null))}
        onConfirm={confirmNow}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        loading={actionBusy}
      />
    </div>
  );
}

/* ── Businesses ─────────────────────────────────────────────────────── */

function TenantsPanel({ rows, loading, busyId, onManage, onSuspend, onActivate }) {
  if (!loading && rows.length === 0) {
    return <EmptyState icon={Building2} title="No businesses found" description="Register a business to get started." />;
  }

  return (
    <>
      {/* Mobile: cards */}
      <div className="divide-y divide-slate-100 md:hidden">
        {rows.map((t) => (
          <div key={t.id} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{t.name}</p>
                <p className="truncate text-xs text-slate-400">{t.slug}</p>
              </div>
              <StatusPill status={t.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Customers" value={t.counts.customers} />
              <MiniStat label="Invoices" value={t.counts.invoices} />
              <MiniStat label="Invoiced" value={money(t.invoiced, t.currency)} />
            </div>
            {t.owner && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                <Mail className="size-3.5" /> {t.owner.email}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onManage(t)}>
                <KeyRound className="size-3.5" /> Tenant admins ({t.adminsCount ?? 0})
              </Button>
              {t.status === 'ACTIVE' ? (
                <Button variant="secondary" size="sm" className="text-rose-600" disabled={busyId === t.id} onClick={() => onSuspend(t)}>
                  <Ban className="size-3.5" /> Suspend
                </Button>
              ) : (
                <Button variant="secondary" size="sm" className="text-emerald-700" disabled={busyId === t.id} onClick={() => onActivate(t)}>
                  <Power className="size-3.5" /> Reactivate
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1000px] border-collapse">
          <thead className="bg-slate-50/70">
            <tr>
              <th className={th}>Business</th>
              <th className={th}>Status</th>
              <th className={th}>Owner</th>
              <th className={th}>Admins</th>
              <th className={th}>Customers</th>
              <th className={th}>Invoices</th>
              <th className={th}>Invoiced</th>
              <th className={th}>Outstanding</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={trHover}>
                <td className={td}>
                  <p className="font-medium text-slate-900">{t.name}</p>
                  <p className="text-xs text-slate-400">{t.slug}</p>
                </td>
                <td className={td}><StatusPill status={t.status} /></td>
                <td className={td}>
                  {t.owner ? (
                    <>
                      <p className="text-slate-800">{t.owner.name}</p>
                      <p className="text-xs text-slate-400">{t.owner.email}</p>
                    </>
                  ) : (
                    <span className="text-rose-500">No owner</span>
                  )}
                </td>
                <td className={td}>{t.adminsCount ?? 0}</td>
                <td className={td}>{t.counts.customers}</td>
                <td className={td}>{t.counts.invoices}</td>
                <td className={`${td} font-medium text-slate-900`}>{money(t.invoiced, t.currency)}</td>
                <td className={`${td} text-amber-700`}>{money(t.outstanding, t.currency)}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => onManage(t)}>
                      <KeyRound className="size-3.5" /> Tenant admins
                    </Button>
                    {t.status === 'ACTIVE' ? (
                      <Button variant="secondary" size="sm" className="text-rose-600" disabled={busyId === t.id} onClick={() => onSuspend(t)}>
                        <Ban className="size-3.5" /> Suspend
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" className="text-emerald-700" disabled={busyId === t.id} onClick={() => onActivate(t)}>
                        <Power className="size-3.5" /> Reactivate
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && rows.length === 0 && <div className="p-6"><LoadingBlock label="Loading businesses…" /></div>}
    </>
  );
}

/* ── Users ──────────────────────────────────────────────────────────── */

function UsersPanel({ rows, loading, busyId, currentUserId, onToggleStatus, onTogglePlatformAdmin }) {
  if (!loading && rows.length === 0) {
    return <EmptyState icon={ShieldCheck} title="No platform admins" description="Add a platform user to grant access to the administration area." />;
  }

  // Every row here is a platform operator. Your own account is never
  // actionable (the server refuses self-suspend and self-demotion).
  const actions = (u) => {
    if (u.id === currentUserId) {
      return <span className="text-xs font-medium text-slate-400">You</span>;
    }
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="text-rose-600" disabled={busyId === u.id} onClick={() => onTogglePlatformAdmin(u)}>
          <ShieldCheck className="size-3.5" /> Remove admin
        </Button>
        {u.status === 'ACTIVE' ? (
          <Button variant="secondary" size="sm" className="text-rose-600" disabled={busyId === u.id} onClick={() => onToggleStatus(u)}>
            <Ban className="size-3.5" /> Suspend
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="text-emerald-700" disabled={busyId === u.id} onClick={() => onToggleStatus(u)}>
            <Power className="size-3.5" /> Reactivate
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile: cards */}
      <div className="divide-y divide-slate-100 md:hidden">
        {rows.map((u) => (
          <div key={u.id} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                  <span className="truncate">{u.name}</span>
                  {u.isPlatformAdmin && <Badge className="bg-brand-600 text-white ring-brand-600">Platform admin</Badge>}
                  {u.status !== 'ACTIVE' && <StatusPill status={u.status} />}
                </p>
                <p className="truncate text-xs text-slate-400">{u.email}</p>
              </div>
              <span className="shrink-0 text-[11px] text-slate-400">{formatDate(u.createdAt)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(u.memberships || []).length === 0 ? (
                <span className="text-xs text-slate-400">No business memberships</span>
              ) : (
                (u.memberships || []).map((m) => (
                  <Badge key={`${m.tenant.id}-${m.role}`} className={ROLE_BADGE[m.role]}>
                    {m.tenant.name} · {ROLE_LABEL[m.role]}
                  </Badge>
                ))
              )}
            </div>
            <div className="mt-3">{actions(u)}</div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] border-collapse">
          <thead className="bg-slate-50/70">
            <tr>
              <th className={th}>Platform admin</th>
              <th className={th}>Status</th>
              <th className={th}>Verified</th>
              <th className={th}>Businesses</th>
              <th className={th}>Joined</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={trHover}>
                <td className={td}>
                  <p className="flex items-center gap-1.5 font-medium text-slate-900">
                    {u.name}
                    {u.isPlatformAdmin && <Badge className="bg-brand-600 text-white ring-brand-600">Platform admin</Badge>}
                  </p>
                  <p className="text-xs text-slate-400">{u.email}</p>
                </td>
                <td className={td}><StatusPill status={u.status} /></td>
                <td className={td}>
                  {u.emailVerified ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" /> Verified</span>
                  ) : (
                    <span className="text-xs text-slate-400">Unverified</span>
                  )}
                </td>
                <td className={td}>
                  {(u.memberships || []).length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(u.memberships || []).map((m) => (
                        <Badge key={`${m.tenant.id}-${m.role}`} className={ROLE_BADGE[m.role]}>
                          {m.tenant.name} · {ROLE_LABEL[m.role]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-slate-500`}>{formatDate(u.createdAt)}</td>
                <td className={td}>{actions(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && rows.length === 0 && <div className="p-6"><LoadingBlock label="Loading platform admins…" /></div>}
    </>
  );
}

/* ── Create business ────────────────────────────────────────────────── */

function CreateBusinessModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', phone: '', email: '', country: 'Nigeria', currency: 'NGN', ownerEmail: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm({ name: '', phone: '', email: '', country: 'Nigeria', currency: 'NGN', ownerEmail: '' });
      setError('');
    }
  }, [open]);

  const submit = async () => {
    if (form.name.trim().length < 2) {
      setError('Enter a business name (at least 2 characters).');
      return;
    }
    setBusy(true);
    try {
      const preset = CURRENCY_PRESETS.find((c) => c.code === form.currency) || CURRENCY_PRESETS[0];
      const { data } = await api.post('/admin/tenants', {
        name: form.name.trim(),
        phone: form.phone,
        email: form.email,
        country: form.country,
        currency: { code: preset.code, symbol: preset.symbol, position: 'prefix' },
        ownerEmail: form.ownerEmail.trim() || undefined,
      });
      toast.success(`${data.data.name} registered${data.data.owner ? ` — ${data.data.owner.email} is the owner.` : ' (no owner yet).'}`);
      onCreated();
    } catch (err) {
      setError(apiMessage(err, 'Could not register the business.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register a new business"
      description="Creates a fully isolated workspace with its own document sequences."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Register business</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Business name" required>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Studios Ltd" autoFocus />
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
        <Field label="Owner email" hint="Optional. Must already have a TG Invoice account — they become the business owner.">
          <input className="input" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="owner@business.com" />
        </Field>
        {error && (
          <p className="flex items-start gap-1.5 text-[13px] text-rose-600">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ── Add platform user ──────────────────────────────────────────────── */

function AddPlatformUserModal({ open, onClose, onAdded }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', password: '' });
      setError('');
      setResult(null);
    }
  }, [open]);

  const submit = async () => {
    if (!form.email.trim()) {
      setError('Enter the email of the platform user.');
      return;
    }
    if (form.password && form.password.length < 8) {
      setError('The password must be at least 8 characters — or leave it blank to auto-generate.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/admin/users', {
        name: form.name.trim() || undefined,
        email: form.email.trim(),
        password: form.password.trim() || undefined,
      });
      setResult(data.data);
      toast.success(
        data.data.promoted
          ? `${data.data.user.email} is now a platform admin.`
          : `Platform account created for ${data.data.user.email}.`
      );
      onAdded?.();
    } catch (err) {
      setError(apiMessage(err, 'Could not add the platform user.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Temporary password copied.');
    } catch {
      toast.error('Copy failed — select and copy it manually.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a platform user"
      description="Promote an existing account, or create a new operator of the super-admin platform."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} loading={busy}>Add platform user</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <div className="text-[13px] text-emerald-800">
              <p className="font-medium">{result.promoted ? 'Existing account promoted' : 'Platform account created'}</p>
              <p className="mt-0.5">{result.user.name} · {result.user.email}</p>
            </div>
          </div>

          {result.temporaryPassword && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-800">
                <KeyRound className="size-4" /> Temporary password
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Shown once. Share it securely — it was not emailed and will never be displayed again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all truncate rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-800">
                  {result.temporaryPassword}
                </code>
                <Button variant="secondary" size="sm" onClick={() => copy(result.temporaryPassword)}>
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
            </div>
          )}

          {result.promoted && (
            <p className="text-[13px] text-slate-500">They keep their existing password and business memberships.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Email" required hint="If an account already exists it is promoted; otherwise a new operator account is created.">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="operator@example.com" autoFocus />
          </Field>
          <Field label="Full name" hint="Used only when creating a new account.">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Operator" />
          </Field>
          <Field label="Password" hint="Optional. Leave blank to auto-generate a temporary one (recommended).">
            <input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Auto-generate" autoComplete="new-password" />
          </Field>
          {error && (
            <p className="flex items-start gap-1.5 text-[13px] text-rose-600">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── Manage access ──────────────────────────────────────────────────── */

function ManageAccessModal({ tenant, loading, busyId, onClose, onGrant, onRevoke }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ADMIN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEmail('');
    setRole('ADMIN');
    setError('');
  }, [tenant?.id]);

  const submit = async () => {
    if (!email.trim()) {
      setError('Enter the email of a registered account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onGrant(tenant.id, { email: email.trim(), role });
      setEmail('');
      setRole('ADMIN');
    } catch (err) {
      setError(apiMessage(err, 'Could not grant access.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!tenant}
      onClose={onClose}
      title={tenant ? `Tenant admins — ${tenant.name}` : 'Tenant admins'}
      description="Grant a registered account owner/admin access to this business. Tenant staff are managed by the business's own admins."
      size="lg"
    >
      {loading ? (
        <LoadingBlock label="Loading members…" />
      ) : (
        <div className="space-y-5">
          {/* Add member */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
              <UserPlus className="size-4" /> Grant access
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                className="input flex-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <Select value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-36">
                <option value="OWNER">Owner</option>
                <option value="ADMIN">Admin</option>
              </Select>
              <Button onClick={submit} loading={busy} className="sm:w-auto">Grant</Button>
            </div>
            {error && <p className="mt-2 text-[13px] text-rose-600">{error}</p>}
            <p className="mt-2 text-xs text-slate-400">The person must already have a TG Invoice account.</p>
          </div>

          {/* Members */}
          <div>
            <p className="mb-2 text-[13px] font-semibold text-slate-700">
              Tenant admins ({(tenant?.members || []).length})
            </p>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {(tenant?.members || []).length === 0 && (
                <p className="px-4 py-3 text-[13px] text-slate-400">No tenant admins yet.</p>
              )}
              {(tenant?.members || []).map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-semibold text-brand-700">
                    {initials(m.user.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-800">{m.user.name}</p>
                    <p className="truncate text-xs text-slate-400">{m.user.email}</p>
                  </div>
                  <Badge className={ROLE_BADGE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-rose-600"
                    disabled={busyId === m.user.id}
                    onClick={() => onRevoke(tenant.id, m)}
                    title="Revoke access"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-[13px] font-semibold text-slate-800">{value}</p>
    </div>
  );
}
