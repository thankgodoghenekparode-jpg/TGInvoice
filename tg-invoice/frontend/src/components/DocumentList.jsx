import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, FileText } from 'lucide-react';
import { useDebounced } from '../hooks/useList.js';
import { useSettings } from '../hooks/useSettings.js';
import { formatDate } from '../utils/dates.js';
import { pluralLabel } from '../utils/status.js';
import { Spinner, EmptyState, Pagination, StatusBadge, th, td, trHover } from './ui.jsx';

/**
 * Shared paged list for quotations and invoices.
 * Fetching is done by the caller (usePagedList) so pages can add extra data;
 * this component renders the toolbar, table and pagination.
 */
export default function DocumentList({
  icon = FileText,
  kind, // 'quotation' | 'invoice'
  rows,
  meta,
  page,
  setPage,
  loading,
  error,
  search,
  onSearch,
  status,
  onStatus,
  statuses = [],
  emptyTitle,
  emptyDescription,
  newLabel,
  newPath,
  rowLink,
  extraColumns = [],
  toolbar = null,
}) {
  const { money } = useSettings();
  const isInvoice = kind === 'invoice';
  const number = (d) => (isInvoice ? d.invoiceNumber : d.quotationNumber);
  const docDate = (d) => (isInvoice ? d.invoiceDate : d.quotationDate);
  const endDate = (d) => (isInvoice ? d.dueDate : d.validUntil);
  const amountLabel = isInvoice ? 'Amount' : 'Total';
  const endLabel = isInvoice ? 'Due' : 'Valid until';

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search number, customer…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => onStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        {toolbar}
        {loading && <Spinner className="size-4" />}
      </div>

      {error ? (
        <EmptyState icon={icon} title={`Could not load ${pluralLabel(kind)}s`} description={error} />
      ) : loading && !rows.length ? (
        <div className="py-10"><Spinner className="mx-auto size-6" /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Link to={newPath} className="btn btn-primary btn-sm">
              <Plus size={15} /> {newLabel}
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                <th className={th}>Number</th>
                <th className={th}>Customer</th>
                <th className={th}>Date</th>
                {extraColumns.map((c) => (
                  <th key={c.key} className={`${th} ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
                ))}
                <th className={`${th} text-right`}>{amountLabel}</th>
                {isInvoice && <th className={`${th} text-right`}>Balance</th>}
                <th className={th}>Status</th>
                <th className={th}>{endLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className={trHover}>
                  <td className={td}>
                    <Link to={rowLink(d)} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                      {number(d)}
                    </Link>
                  </td>
                  <td className={td}>
                    <span className="block max-w-[16rem] truncate text-slate-700">
                      {d.customer?.companyName || d.customer?.name || '—'}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-slate-600`}>{formatDate(docDate(d))}</td>
                  {extraColumns.map((c) => (
                    <td key={c.key} className={`${td} ${c.align === 'right' ? 'text-right' : ''} text-slate-600`}>
                      {c.render(d)}
                    </td>
                  ))}
                  <td className={`${td} text-right font-medium text-slate-900`}>{money(d.total)}</td>
                  {isInvoice && (
                    <td className={`${td} text-right`}>
                      {Number(d.balanceDue) > 0 ? (
                        <span className="font-semibold text-rose-600">{money(d.balanceDue)}</span>
                      ) : (
                        <span className="text-slate-400">{money(0)}</span>
                      )}
                    </td>
                  )}
                  <td className={td}><StatusBadge status={d.status} kind={kind} /></td>
                  <td className={`${td} whitespace-nowrap text-slate-600`}>
                    {endDate(d) ? formatDate(endDate(d)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label={`${pluralLabel(kind)}s`} />
        </div>
      )}
    </div>
  );
}

/** Standard search + status URL state wiring shared by both list pages. */
export function useDocumentFilters() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const debounced = useDebounced(search);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('search', debounced);
    else next.delete('search');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (status) next.set('status', status);
    else next.delete('status');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return { search, setSearch, status, setStatus, debounced };
}
