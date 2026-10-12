import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Receipt, Search } from 'lucide-react';
import { usePagedList, useDebounced } from '../../hooks/useList.js';
import { useSettings } from '../../hooks/useSettings.js';
import { formatDate } from '../../utils/dates.js';
import { paymentMethodLabel } from '../../utils/status.js';
import { PageHeader, Spinner, EmptyState, Pagination, StatusBadge, th, td, trHover } from '../../components/ui.jsx';

export default function ReceiptsPage() {
  const { money } = useSettings();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const debounced = useDebounced(search);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('search', debounced);
    else next.delete('search');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { rows, meta, page, setPage, loading, error } = usePagedList('/receipts', { search: debounced });

  const totalReceived = rows
    .filter((r) => r.status !== 'VOID')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Receipts"
        subtitle={`${meta.total.toLocaleString()} receipt${meta.total === 1 ? '' : 's'} · every payment automatically generates one`}
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search receipt no, invoice no, customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {totalReceived > 0 && (
            <span className="ml-auto text-sm text-slate-500">
              On this page: <span className="font-semibold text-emerald-700">{money(totalReceived)}</span> received
            </span>
          )}
          {loading && <Spinner className="size-4" />}
        </div>

        {error ? (
          <EmptyState icon={Receipt} title="Could not load receipts" description={error} />
        ) : loading && !rows.length ? (
          <div className="py-10"><Spinner className="mx-auto size-6" /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={debounced ? 'No receipts match your search' : 'No receipts yet'}
            description={
              debounced
                ? 'Try a different search term.'
                : 'Record a payment on an invoice and its receipt is created for you automatically.'
            }
            action={
              !debounced && (
                <Link to="/invoices" className="btn btn-primary btn-sm">
                  Go to invoices
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className={th}>Receipt</th>
                  <th className={th}>Date</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Invoice</th>
                  <th className={th}>Method</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={trHover}>
                    <td className={td}>
                      <Link to={`/receipts/${r.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                        {r.receiptNumber}
                      </Link>
                    </td>
                    <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(r.receiptDate)}</td>
                    <td className={td}>
                      <span className="block max-w-[16rem] truncate text-slate-700">
                        {r.customer?.companyName || r.customer?.name || '—'}
                      </span>
                    </td>
                    <td className={`${td} font-mono text-xs text-slate-500`}>{r.invoice?.invoiceNumber || '—'}</td>
                    <td className={`${td} text-slate-600`}>{paymentMethodLabel(r.paymentMethod)}</td>
                    <td className={`${td} text-right font-semibold text-emerald-700`}>{money(r.amount)}</td>
                    <td className={td}><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label="receipts" />
          </div>
        )}
      </div>
    </div>
  );
}
