import { Link } from 'react-router-dom';
import { Plus, Receipt } from 'lucide-react';
import { usePagedList } from '../../hooks/useList.js';
import { useSettings } from '../../hooks/useSettings.js';
import { PageHeader } from '../../components/ui.jsx';
import DocumentList, { useDocumentFilters } from '../../components/DocumentList.jsx';

const STATUSES = ['DRAFT', 'SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];

export default function InvoicesPage() {
  const { money } = useSettings();
  const { search, setSearch, status, setStatus, debounced } = useDocumentFilters();
  const { rows, meta, page, setPage, loading, error } = usePagedList('/invoices', {
    search: debounced,
    status,
  });

  const outstanding = rows.reduce((sum, i) => sum + (Number(i.balanceDue) > 0 && !['CANCELLED', 'VOID', 'DRAFT'].includes(i.status) ? Number(i.balanceDue) : 0), 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={`${meta.total.toLocaleString()} invoice${meta.total === 1 ? '' : 's'} in this business`}
        actions={
          <Link to="/invoices/new" className="btn btn-primary btn-sm">
            <Plus size={15} /> New invoice
          </Link>
        }
      />

      <DocumentList
        kind="invoice"
        icon={Receipt}
        rows={rows}
        meta={meta}
        page={page}
        setPage={setPage}
        loading={loading}
        error={error}
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        statuses={STATUSES}
        newPath="/invoices/new"
        newLabel="New invoice"
        rowLink={(i) => `/invoices/${i.id}`}
        emptyTitle={debounced ? 'No invoices match your search' : 'No invoices yet'}
        emptyDescription={
          debounced
            ? 'Try a different search term.'
            : 'Turn an accepted quotation into an invoice, or create one from scratch.'
        }
        toolbar={
          outstanding > 0 ? (
            <span className="ml-auto text-sm text-slate-500">
              On this page:{' '}
              <span className="font-semibold text-rose-600">{money(outstanding)}</span> outstanding
            </span>
          ) : null
        }
      />
    </div>
  );
}
