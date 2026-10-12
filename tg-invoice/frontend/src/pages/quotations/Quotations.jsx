import { Link } from 'react-router-dom';
import { Plus, FileText } from 'lucide-react';
import { usePagedList } from '../../hooks/useList.js';
import { PageHeader } from '../../components/ui.jsx';
import DocumentList, { useDocumentFilters } from '../../components/DocumentList.jsx';

const STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'];

export default function QuotationsPage() {
  const { search, setSearch, status, setStatus, debounced } = useDocumentFilters();
  const { rows, meta, page, setPage, loading, error } = usePagedList('/quotations', {
    search: debounced,
    status,
  });

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle={`${meta.total.toLocaleString()} quotation${meta.total === 1 ? '' : 's'} in this business`}
        actions={
          <Link to="/quotations/new" className="btn btn-primary btn-sm">
            <Plus size={15} /> New quotation
          </Link>
        }
      />

      <DocumentList
        kind="quotation"
        icon={FileText}
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
        newPath="/quotations/new"
        newLabel="New quotation"
        rowLink={(q) => `/quotations/${q.id}`}
        emptyTitle={debounced ? 'No quotations match your search' : 'No quotations yet'}
        emptyDescription={
          debounced
            ? 'Try a different search term.'
            : 'Quote a job, get it accepted, then convert it to an invoice in one click.'
        }
      />
    </div>
  );
}
