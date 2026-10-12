import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, ArrowUpRight, CircleAlert, Wallet, Receipt } from 'lucide-react';
import api, { apiMessage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../context/ToastContext.jsx';
import { StatCard, Spinner, EmptyState, Badge } from '../components/ui.jsx';
import { RevenueChart, StatusDonut } from '../components/charts.jsx';
import { statusMeta } from '../utils/status.js';
import { formatDateTime } from '../utils/dates.js';

const RECENT_TYPE_META = {
  INVOICE: { to: (id) => `/invoices/${id}`, kind: 'invoice' },
  QUOTATION: { to: (id) => `/quotations/${id}`, kind: 'quotation' },
  RECEIPT: { to: (id) => `/receipts/${id}`, kind: 'receipt' },
};

export default function DashboardPage() {
  const { user, activeTenant } = useAuth();
  const { money, settings, compact } = useSettings();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/reports/dashboard')
      .then(({ data: res }) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) toast.error(apiMessage(err, 'Could not load the dashboard.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant?.id]);

  const firstName = user?.name?.split(' ')[0] || 'there';

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-8" />
      </div>
    );
  }

  const d = data || {};
  const status = d.invoiceStatus || {};
  const donutData = [
    { label: 'PAID', value: status.paid || 0 },
    { label: 'PARTIALLY_PAID', value: status.partiallyPaid || 0 },
    { label: 'UNPAID', value: status.unpaid || 0 },
    { label: 'OVERDUE', value: status.overdue || 0 },
    { label: 'DRAFT', value: status.draft || 0 },
    { label: 'CANCELLED', value: status.cancelled || 0 },
  ].filter((x) => x.value > 0);

  const chartData = (d.revenue || []).map((m) => ({ label: m.label, issued: m.invoiced, paid: m.paid }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Welcome back, {firstName} 👋
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Here’s how <strong>{settings.businessName || activeTenant?.name}</strong> is doing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/quotations/new" className="btn btn-secondary btn-sm">
            <FileText size={15} /> New quotation
          </Link>
          <Link to="/invoices/new" className="btn btn-primary btn-sm">
            <Plus size={15} /> New invoice
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total invoiced" tone="brand" value={compact(d.totalInvoiced)} sub={`${d.totalInvoiced ? Math.round((d.totalPaid / d.totalInvoiced) * 100) : 0}% collected overall`} />
        <StatCard label="Total collected" value={compact(d.totalPaid)} tone="green" sub={`${d.totalReceipts || 0} receipt${(d.totalReceipts || 0) === 1 ? '' : 's'} issued`} />
        <StatCard label="Outstanding" value={compact(d.outstanding)} tone="amber" sub={`${d.totalInvoices || 0} invoice${(d.totalInvoices || 0) === 1 ? '' : 's'} issued`} />
        <StatCard
          label="Overdue"
          value={String(status.overdue || 0)}
          tone="rose"
          sub={status.overdue ? `invoice${status.overdue === 1 ? '' : 's'} past due` : 'Nothing overdue'}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-blue p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Issued vs collected</h2>
              <p className="text-xs text-slate-400">Last 12 months</p>
            </div>
            <Link to="/reports" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Full reports →
            </Link>
          </div>
          <RevenueChart data={chartData} />
        </div>
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Invoices by status</h2>
          <StatusDonut data={donutData} total={d.totalInvoices || 0} centerLabel="Invoices" />
        </div>
      </div>

      {/* Recent documents */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent documents</h2>
            <p className="text-xs text-slate-400">Latest quotations, invoices and receipts</p>
          </div>
          <div className="flex gap-3 text-xs font-medium">
            <Link to="/invoices" className="text-brand-600 hover:text-brand-700">Invoices</Link>
            <Link to="/quotations" className="text-brand-600 hover:text-brand-700">Quotations</Link>
            <Link to="/receipts" className="text-brand-600 hover:text-brand-700">Receipts</Link>
          </div>
        </div>

        {(d.recentDocuments || []).length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No documents yet"
            description="Create your first quotation or invoice to see activity here."
            action={
              <Link to="/invoices/new" className="btn btn-primary btn-sm mt-1">
                <Plus size={15} /> Create invoice
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Type</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Number</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Customer</th>
                  <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date</th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {(d.recentDocuments || []).map((doc) => {
                  const meta = RECENT_TYPE_META[doc.type];
                  const kind = meta.kind;
                  const sm = statusMeta(doc.status, kind === 'receipt' ? 'invoice' : kind);
                  return (
                    <tr key={`${doc.type}-${doc.id}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3 text-sm">
                        <span className="text-slate-500">{doc.type}</span>
                      </td>
                      <td className="px-5 py-3">
                        <Link to={meta.to(doc.id)} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                          {doc.number} <ArrowUpRight size={13} />
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">{doc.customer || '—'}</td>
                      <td className="px-5 py-3 text-sm text-slate-500">{formatDateTime(doc.date)}</td>
                      <td className="px-5 py-3 text-right text-sm font-medium text-slate-900">{money(doc.amount)}</td>
                      <td className="px-5 py-3 text-right">
                        <Badge className={sm.className}>{sm.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick stats strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link to="/quotations" className="card-blue card-hover flex items-center gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><FileText size={18} /></span>
          <span>
            <span className="block text-lg font-semibold text-slate-900">{d.totalQuotations || 0}</span>
            <span className="block text-xs text-slate-500">Quotations sent</span>
          </span>
        </Link>
        <Link to="/receipts" className="card card-hover flex items-center gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Receipt size={18} /></span>
          <span>
            <span className="block text-lg font-semibold text-slate-900">{d.totalReceipts || 0}</span>
            <span className="block text-xs text-slate-500">Receipts issued</span>
          </span>
        </Link>
        <Link to="/reports" className="card card-hover flex items-center gap-3 p-4">
          <span className="flex size-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Wallet size={18} /></span>
          <span>
            <span className="block text-lg font-semibold text-slate-900">{compact(d.outstanding)}</span>
            <span className="block text-xs text-slate-500">Money to collect</span>
          </span>
        </Link>
      </div>

      {status.overdue > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <CircleAlert size={16} />
          You have {status.overdue} overdue invoice{status.overdue === 1 ? '' : 's'}.{' '}
          <Link to="/invoices?status=OVERDUE" className="font-semibold underline">
            Review them
          </Link>
          .
        </div>
      )}
    </div>
  );
}
