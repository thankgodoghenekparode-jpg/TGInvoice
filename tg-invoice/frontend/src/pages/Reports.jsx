import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Banknote, Users, Quote } from 'lucide-react';
import api, { apiMessage } from '../services/api.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  PageHeader, Tabs, StatCard, Spinner, EmptyState, StatusBadge, th, td, trHover,
} from '../components/ui.jsx';
import { formatDate } from '../utils/dates.js';
import { paymentMethodLabel } from '../utils/status.js';

const PERIODS = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom…' },
];

const TABS = [
  { value: 'invoices', label: 'Invoices' },
  { value: 'payments', label: 'Payments' },
  { value: 'quotations', label: 'Quotations' },
  { value: 'customers', label: 'Customers' },
];

const ENDPOINTS = {
  invoices: '/reports/invoices',
  payments: '/reports/payments',
  quotations: '/reports/quotations',
  customers: '/reports/customers',
};

export default function ReportsPage() {
  const toast = useToast();
  const { money } = useSettings();

  const [tab, setTab] = useState('invoices');
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Drop the previous payload immediately so another tab's rows can never
    // render under this tab's column headers while the request is in flight.
    setData(null);
    const params = {};
    if (period) params.period = period;
    if (period === 'custom') {
      if (from) params.from = from;
      if (to) params.to = to;
    }
    api
      .get(ENDPOINTS[tab], { params })
      .then(({ data: res }) => {
        if (!cancelled) {
          setData(res.data);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(apiMessage(err, 'Could not load the report.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, period, from, to]);

  const exportCsv = () => {
    if (!data?.rows?.length) return;
    setExporting(true);
    try {
      const keys = Object.keys(data.rows[0]).filter((k) => k !== 'customer');
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        keys.join(','),
        ...data.rows.map((r) => keys.map((k) => esc(r[k])).join(',')),
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tg-invoice-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded.');
    } catch {
      toast.error('Could not export the report.');
    } finally {
      setExporting(false);
    }
  };

  const summaryCards = useMemo(() => {
    if (!data?.summary) return [];
    const s = data.summary;
    if (tab === 'invoices') {
      return [
        { label: 'Invoices', value: s.totalInvoices, icon: FileText, tone: 'brand' },
        { label: 'Invoiced', value: money(s.totalInvoiced), icon: Banknote, tone: 'default' },
        { label: 'Received', value: money(s.totalPaid), icon: Banknote, tone: 'green' },
        { label: 'Outstanding', value: money(s.outstanding), icon: Banknote, tone: 'amber' },
        { label: 'Overdue', value: `${s.overdueCount} · ${money(s.overdueAmount)}`, icon: FileText, tone: 'rose' },
      ];
    }
    if (tab === 'payments') {
      return [
        { label: 'Payments', value: s.totalPayments, icon: Banknote, tone: 'brand' },
        { label: 'Total received', value: money(s.totalReceived), icon: Banknote, tone: 'green' },
      ];
    }
    if (tab === 'quotations') {
      return [
        { label: 'Quotations', value: s.totalQuotations, icon: Quote, tone: 'brand' },
        { label: 'Quoted value', value: money(s.totalQuotedValue), icon: Banknote, tone: 'default' },
        { label: 'Accepted', value: s.accepted, icon: Quote, tone: 'green' },
        { label: 'Pending', value: s.pending, icon: Quote, tone: 'amber' },
        { label: 'Converted', value: s.converted, icon: Quote, tone: 'brand' },
      ];
    }
    return [
      { label: 'Customers invoiced', value: s.totalCustomers, icon: Users, tone: 'brand' },
      { label: 'Invoiced', value: money(s.totalInvoiced), icon: Banknote, tone: 'default' },
      { label: 'Received', value: money(s.totalPaid), icon: Banknote, tone: 'green' },
      { label: 'Outstanding', value: money(s.outstanding), icon: Banknote, tone: 'rose' },
    ];
  }, [data, tab, money]);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Every figure is calculated by the server from your stored documents and payments."
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={exportCsv}
            disabled={exporting || !data?.rows?.length}
          >
            <Download size={15} /> Export CSV
          </button>
        }
      />

      {/* Toolbar */}
      <div className="card-blue mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-500">
            Period
            <select className="input mt-1 w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          {period === 'custom' && (
            <>
              <label className="text-xs font-medium text-slate-500">
                From
                <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-xs font-medium text-slate-500">
                To
                <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
          {loading && <Spinner className="size-4 mb-2" />}
        </div>
      </div>

      {/* Summary */}
      {summaryCards.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {summaryCards.map((c) => (
            <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} />
          ))}
        </div>
      )}

      {/* Detail */}
      {error ? (
        <EmptyState icon={FileText} title="Could not load the report" description={error} />
      ) : loading && !data ? (
        <div className="card py-12"><Spinner className="mx-auto size-6" /></div>
      ) : !data?.rows?.length ? (
        <EmptyState
          icon={FileText}
          title="Nothing to report yet"
          description="There are no records in this period. Try a wider date range."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            {tab === 'invoices' && (
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Invoice</th>
                    <th className={th}>Date</th>
                    <th className={th}>Due</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Paid</th>
                    <th className={`${th} text-right`}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className={trHover}>
                      <td className={`${td} font-mono text-xs font-semibold text-brand-600`}>{r.invoiceNumber}</td>
                      <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(r.invoiceDate)}</td>
                      <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(r.dueDate)}</td>
                      <td className={td}>{r.customerName || '—'}</td>
                      <td className={td}><StatusBadge status={r.status} /></td>
                      <td className={`${td} text-right font-medium`}>{money(r.total)}</td>
                      <td className={`${td} text-right text-emerald-700`}>{money(r.amountPaid)}</td>
                      <td className={`${td} text-right ${Number(r.balanceDue) > 0 ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>
                        {money(r.balanceDue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'payments' && (
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Date</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Invoice</th>
                    <th className={th}>Receipt</th>
                    <th className={th}>Method</th>
                    <th className={th}>Reference</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className={trHover}>
                      <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(r.paymentDate)}</td>
                      <td className={td}>{r.customerName || '—'}</td>
                      <td className={`${td} font-mono text-xs text-slate-500`}>{r.invoiceNumber || '—'}</td>
                      <td className={`${td} font-mono text-xs text-slate-500`}>{r.receiptNumber || '—'}</td>
                      <td className={`${td} text-slate-600`}>{paymentMethodLabel(r.paymentMethod)}</td>
                      <td className={`${td} text-slate-500`}>{r.reference || '—'}</td>
                      <td className={`${td} text-right font-semibold text-emerald-700`}>{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'quotations' && (
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Quotation</th>
                    <th className={th}>Date</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className={trHover}>
                      <td className={`${td} font-mono text-xs font-semibold text-brand-600`}>{r.quotationNumber}</td>
                      <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(r.quotationDate)}</td>
                      <td className={td}>{r.customerName || '—'}</td>
                      <td className={td}><StatusBadge status={r.status} kind="quotation" /></td>
                      <td className={`${td} text-right font-medium`}>{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'customers' && (
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Code</th>
                    <th className={th}>Customer</th>
                    <th className={`${th} text-right`}>Invoices</th>
                    <th className={`${th} text-right`}>Invoiced</th>
                    <th className={`${th} text-right`}>Received</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.customerId} className={trHover}>
                      <td className={`${td} font-mono text-xs text-slate-500`}>{r.customerCode}</td>
                      <td className={td}>{r.customerName}</td>
                      <td className={`${td} text-right`}>{r.invoiceCount}</td>
                      <td className={`${td} text-right font-medium`}>{money(r.totalInvoiced)}</td>
                      <td className={`${td} text-right text-emerald-700`}>{money(r.totalPaid)}</td>
                      <td className={`${td} text-right ${Number(r.outstanding) > 0 ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>
                        {money(r.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
            Showing {data.rows.length} record{data.rows.length === 1 ? '' : 's'} (max 500 per report).
          </p>
        </div>
      )}
    </div>
  );
}
