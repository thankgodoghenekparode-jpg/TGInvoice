import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Play, Pause, RotateCw, Repeat, Trash2, PencilLine } from 'lucide-react';
import clsx from 'clsx';
import { apiMessage } from '../../services/api.js';
import { recurringApi, scheduleLabel } from '../../services/billing.js';
import { usePagedList, useDebounced } from '../../hooks/useList.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, Badge, Button, ConfirmDialog, EmptyState, Pagination, LoadingBlock, Select, td, th, trHover,
} from '../../components/ui.jsx';
import { formatDate } from '../../utils/dates.js';

const STATUS_STYLE = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-700 ring-amber-200',
  COMPLETED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function RecurringInvoicesPage() {
  const { money } = useSettings();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [status, setStatus] = useState('');
  const { rows, meta, page, setPage, loading, error, reload } = usePagedList('/recurring-invoices', {
    search: debounced,
    status,
  });

  const [busyId, setBusyId] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const toggleStatus = async (row) => {
    const next = row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setBusyId(row.id);
    try {
      await recurringApi.setStatus(row.id, next);
      toast.success(next === 'ACTIVE' ? `“${row.name}” resumed.` : `“${row.name}” paused.`);
      reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not update the schedule.'));
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (row) => {
    setBusyId(row.id);
    try {
      const { invoice } = await recurringApi.runNow(row.id);
      toast.success(`Generated invoice ${invoice.invoiceNumber}.`);
      reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not generate the invoice.'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await recurringApi.remove(toDelete.id);
      toast.success(`“${toDelete.name}” deleted. Invoices already raised were kept.`);
      setToDelete(null);
      reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the schedule.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Recurring invoices"
        subtitle="Raise an invoice automatically on a schedule — great for retainers and subscriptions."
        actions={
          <Link to="/recurring/new" className="btn btn-primary btn-sm">
            <Plus size={15} /> New schedule
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <input
            className="input max-w-xs"
            placeholder="Search schedules…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="COMPLETED">Completed</option>
          </Select>
        </div>

        {loading ? (
          <LoadingBlock label="Loading schedules…" />
        ) : error ? (
          <EmptyState title="Could not load schedules" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={debounced || status ? 'No schedules match your filters' : 'No recurring invoices yet'}
            description={
              debounced || status
                ? 'Try a different search term or status.'
                : 'Set one up once and TG Invoice raises the invoice for you every week, month or year.'
            }
            action={
              <Link to="/recurring/new" className="btn btn-primary btn-sm">
                <Plus size={15} /> New schedule
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Schedule</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Repeats</th>
                  <th className={th}>Next invoice</th>
                  <th className={clsx(th, 'text-right')}>Est. total</th>
                  <th className={th}>Status</th>
                  <th className={clsx(th, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={trHover}>
                    <td className={td}>
                      <Link to={`/recurring/${row.id}/edit`} className="font-medium text-slate-800 hover:text-brand-700">
                        {row.name}
                      </Link>
                      <p className="text-xs text-slate-400">Runs {row.generatedCount || 0}× so far</p>
                    </td>
                    <td className={td}>{row.customer?.companyName || row.customer?.name || '—'}</td>
                    <td className={td}>{scheduleLabel(row)}</td>
                    <td className={td}>{formatDate(row.nextRunAt)}</td>
                    <td className={clsx(td, 'text-right font-medium text-slate-800')}>
                      {row.estimatedTotal != null ? money(Number(row.estimatedTotal)) : '—'}
                    </td>
                    <td className={td}>
                      <Badge className={STATUS_STYLE[row.status]}>{row.status.toLowerCase()}</Badge>
                    </td>
                    <td className={td}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Generate an invoice now"
                          disabled={busyId === row.id || row.status === 'COMPLETED'}
                          onClick={() => runNow(row)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                        >
                          <RotateCw size={15} />
                        </button>
                        <button
                          type="button"
                          title={row.status === 'ACTIVE' ? 'Pause this schedule' : 'Resume this schedule'}
                          disabled={busyId === row.id || row.status === 'COMPLETED'}
                          onClick={() => toggleStatus(row)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40"
                        >
                          {row.status === 'ACTIVE' ? <Pause size={15} /> : <Play size={15} />}
                        </button>
                        <Link
                          to={`/recurring/${row.id}/edit`}
                          title="Edit"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <PencilLine size={15} />
                        </Link>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => setToDelete(row)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <Pagination page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label="schedules" />
        )}
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        danger
        title="Delete recurring invoice"
        confirmLabel="Delete schedule"
        message={`Delete “${toDelete?.name}”? Invoices already generated are kept — only the future schedule stops.`}
      />
    </div>
  );
}
