import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Package, Trash2, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { usePagedList, useDebounced } from '../../hooks/useList.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, Spinner, EmptyState, Pagination, ConfirmDialog, Badge, th, td, trHover, Tabs,
} from '../../components/ui.jsx';
import { categoryLabel } from '../../utils/status.js';

export default function ProductsPage() {
  const toast = useToast();
  const { money } = useSettings();
  const [, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [activeFilter, setActiveFilter] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debounced) next.set('search', debounced);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { rows, meta, page, setPage, loading, error, reload } = usePagedList('/products', {
    search: debounced,
    active: activeFilter,
  });

  const toggleActive = async (p) => {
    try {
      await api.put(`/products/${p.id}`, { ...p, active: !p.active });
      toast.success(`${p.name} ${p.active ? 'archived' : 'reactivated'}.`);
      reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not update the product.'));
    }
  };

  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      const { data } = await api.delete(`/products/${deleting.id}`);
      if (data.data?.archived) toast.info(data.data.message);
      else toast.success(data.data?.message || 'Product deleted.');
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the product.'));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Products & services"
        subtitle="Reusable line items — pick them while creating quotations and invoices."
        actions={
          <Link to="/products/new" className="btn btn-primary btn-sm">
            <Plus size={15} /> New product
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Tabs
            tabs={[
              { value: '', label: 'All' },
              { value: 'true', label: 'Active' },
            ]}
            active={activeFilter}
            onChange={setActiveFilter}
          />
          {loading && <Spinner className="size-4" />}
        </div>

        {error ? (
          <EmptyState icon={Package} title="Could not load products" description={error} />
        ) : loading && !rows.length ? (
          <div className="py-10"><Spinner className="mx-auto size-6" /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={debounced ? 'No products match your search' : 'No products yet'}
            description="Add what you sell — name, price and tax — and reuse it on every document."
            action={
              !debounced && (
                <Link to="/products/new" className="btn btn-primary btn-sm">
                  <Plus size={15} /> Add your first product
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className={th}>Name</th>
                  <th className={th}>Category</th>
                  <th className={`${th} text-right`}>Unit price</th>
                  <th className={`${th} text-right`}>Tax rate</th>
                  <th className={`${th} text-right`}>Status</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={trHover}>
                    <td className={td}>
                      <Link to={`/products/${p.id}/edit`} className="font-medium text-slate-900 hover:text-brand-600">
                        {p.name}
                      </Link>
                      {p.description && <span className="block max-w-md truncate text-xs text-slate-400">{p.description}</span>}
                    </td>
                    <td className={td}>
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-200">{categoryLabel(p.category)}</Badge>
                    </td>
                    <td className={`${td} text-right font-medium`}>{money(p.unitPrice)}</td>
                    <td className={`${td} text-right text-slate-500`}>{Number(p.taxRate)}%</td>
                    <td className={`${td} text-right`}>
                      <Badge className={p.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}>
                        {p.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          title={p.active ? 'Deactivate' : 'Activate'}
                          onClick={() => toggleActive(p)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          {p.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                        <Link to={`/products/${p.id}/edit`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
                          <Pencil size={15} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleting(p)}
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
            <Pagination page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label="products" />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        danger
        title="Delete product"
        message={
          deleting
            ? `Delete “${deleting.name}”? If it appears on past documents it will be archived instead so history stays intact.`
            : ''
        }
        confirmLabel="Delete"
      />
    </div>
  );
}
