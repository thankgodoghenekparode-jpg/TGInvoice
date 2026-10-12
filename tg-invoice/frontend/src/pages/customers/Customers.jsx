import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Users, Trash2, Building2 } from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { usePagedList, useDebounced } from '../../hooks/useList.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, Spinner, EmptyState, Pagination, ConfirmDialog, Badge, th, td, trHover,
} from '../../components/ui.jsx';

export default function CustomersPage() {
  const toast = useToast();
  const { money } = useSettings();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const debounced = useDebounced(search);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('search', debounced);
    else next.delete('search');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { rows, meta, page, setPage, loading, error, reload } = usePagedList('/customers', { search: debounced });

  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      const { data } = await api.delete(`/customers/${deleting.id}`);
      toast.success(data.data?.message || 'Customer deleted.');
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the customer.'));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${meta.total.toLocaleString()} customer${meta.total === 1 ? '' : 's'} in this business`}
        actions={
          <Link to="/customers/new" className="btn btn-primary btn-sm">
            <Plus size={15} /> New customer
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search name, company, email, code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {loading && <Spinner className="size-4" />}
        </div>

        {error ? (
          <EmptyState icon={Users} title="Could not load customers" description={error} />
        ) : loading && !rows.length ? (
          <div className="py-10"><Spinner className="mx-auto size-6" /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={debounced ? 'No customers match your search' : 'No customers yet'}
            description={debounced ? 'Try a different search term.' : 'Add the clients you invoice — they’ll appear here with their billing history.'}
            action={
              !debounced && (
                <Link to="/customers/new" className="btn btn-primary btn-sm">
                  <Plus size={15} /> Add your first customer
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className={th}>Code</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Contact</th>
                  <th className={`${th} text-right`}>Invoiced</th>
                  <th className={`${th} text-right`}>Outstanding</th>
                  <th className={`${th} text-right`}>Docs</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={trHover}>
                    <td className={`${td} font-mono text-xs text-slate-500`}>{c.customerCode}</td>
                    <td className={td}>
                      <Link to={`/customers/${c.id}`} className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                          {(c.companyName || c.name).slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{c.companyName || c.name}</span>
                          {c.companyName && <span className="block truncate text-xs text-slate-400">{c.name}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className={td}>
                      <span className="block truncate text-slate-600">{c.email || '—'}</span>
                      <span className="block text-xs text-slate-400">{c.phone || ''}</span>
                    </td>
                    <td className={`${td} text-right font-medium text-slate-900`}>{money(c.totalInvoiced)}</td>
                    <td className={`${td} text-right`}>
                      {c.outstanding > 0 ? (
                        <span className="font-semibold text-rose-600">{money(c.outstanding)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      <Badge className={c.invoiceCount ? 'bg-sky-50 text-sky-700 ring-sky-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}>
                        {c.invoiceCount} inv
                      </Badge>
                    </td>
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <Link to={`/customers/${c.id}/edit`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
                          <Building2 size={15} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleting(c)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label="customers" />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        danger
        title="Delete customer"
        message={
          deleting
            ? `Delete ${deleting.companyName || deleting.name}? Customers with invoices cannot be deleted — you’ll be told if that applies.`
            : ''
        }
        confirmLabel="Delete"
      />
    </div>
  );
}
