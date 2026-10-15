import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, ReceiptText } from 'lucide-react';
import clsx from 'clsx';
import { usePagedList, useDebounced } from '../../hooks/useList.js';
import { useSettings } from '../../hooks/useSettings.js';
import { formatDate } from '../../utils/dates.js';
import {
  PageHeader, StatusBadge, Select, Button, EmptyState, LoadingBlock, Pagination, th, td, trHover,
} from '../../components/ui.jsx';

/** Credit notes — customer credits, optionally tied to an invoice. */
export default function CreditNotesPage() {
  const { money } = useSettings();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debounced = useDebounced(search);
  const { rows, meta, page, setPage, loading, error, reload } = usePagedList('/credit-notes', {
    search: debounced,
    status,
  });

  return (
    <div>
      <PageHeader
        title="Credit notes"
        subtitle="Credit a customer for a return, overcharge or goodwill — apply it to an invoice or refund it."
        actions={
          <Link to="/credit-notes/new" className="btn btn-primary btn-sm">
            <Plus size={15} /> New credit note
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search credit notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ISSUED">Issued</option>
            <option value="APPLIED">Applied</option>
            <option value="VOID">Void</option>
          </Select>
        </div>

        {loading ? (
          <LoadingBlock label="Loading credit notes…" />
        ) : error ? (
          <EmptyState title="Could not load credit notes" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={debounced || status ? 'No credit notes match your filters' : 'No credit notes yet'}
            description={
              debounced || status
                ? 'Try a different search term or status.'
                : 'Create a credit note when you owe a customer money or need to reverse part of an invoice.'
            }
            action={
              <Link to="/credit-notes/new" className="btn btn-primary btn-sm">
                <Plus size={15} /> New credit note
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Credit note</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Date</th>
                  <th className={clsx(th, 'text-right')}>Total</th>
                  <th className={clsx(th, 'text-right')}>Remaining</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={trHover}>
                    <td className={td}>
                      <Link to={`/credit-notes/${row.id}`} className="font-medium text-slate-800 hover:text-brand-700">
                        {row.creditNoteNumber}
                      </Link>
                      {row.invoice?.invoiceNumber && (
                        <p className="text-xs text-slate-400">Against {row.invoice.invoiceNumber}</p>
                      )}
                    </td>
                    <td className={td}>{row.customer?.companyName || row.customer?.name || '—'}</td>
                    <td className={td}>{formatDate(row.creditNoteDate)}</td>
                    <td className={clsx(td, 'text-right font-medium text-slate-800')}>{money(row.total)}</td>
                    <td className={clsx(td, 'text-right text-slate-600')}>{money(row.creditRemaining)}</td>
                    <td className={td}>
                      <StatusBadge status={row.status} kind="creditNote" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <Pagination page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label="credit notes" />
        )}
      </div>
    </div>
  );
}
