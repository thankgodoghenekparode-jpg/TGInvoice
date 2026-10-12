import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Copy, ArrowRightLeft, Trash2, CheckCircle2 } from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, LoadingBlock, ConfirmDialog, StatusBadge, Badge,
} from '../../components/ui.jsx';
import { DocumentPaper, DocumentActions, ConvertToInvoiceModal } from '../../components/documents.jsx';

const STATUS_ACTIONS = [
  { value: 'SENT', label: 'Mark sent', icon: 'send' },
  { value: 'ACCEPTED', label: 'Accepted', icon: 'check' },
  { value: 'REJECTED', label: 'Rejected', icon: 'x' },
  { value: 'EXPIRED', label: 'Expired', icon: 'clock' },
];

export default function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, refresh } = useSettings();

  const [q, setQ] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/quotations/${id}`)
      .then(({ data }) => {
        setQ(data.data);
        setError('');
      })
      .catch((err) => setError(apiMessage(err, 'Could not load the quotation.')))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (status) => {
    setBusy(true);
    try {
      const { data } = await api.put(`/quotations/${id}/status`, { status });
      setQ(data.data);
      toast.success(`Quotation marked as ${status.toLowerCase().replace('_', ' ')}.`);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not update the status.'));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/quotations/${id}/duplicate`);
      toast.success(`Created ${data.data.quotationNumber}.`);
      navigate(`/quotations/${data.data.id}/edit`);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not duplicate the quotation.'));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/quotations/${id}`);
      toast.success(data.data?.message || 'Quotation deleted.');
      navigate('/quotations');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the quotation.'));
      setDeleting(false);
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading quotation…" />;
  if (error || !q) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-rose-600">{error || 'Quotation not found.'}</p>
        <Link to="/quotations" className="btn btn-secondary btn-sm mt-4 mx-auto">
          <ArrowLeft size={15} /> Back to quotations
        </Link>
      </div>
    );
  }

  const converted = q.status === 'CONVERTED';

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {q.quotationNumber}
            <StatusBadge status={q.status} kind="quotation" />
          </span>
        }
        subtitle={`${q.customer?.companyName || q.customer?.name || ''} · ${settings.currency || ''}`.replace(/ · $/, '')}
        actions={
          <div className="flex flex-wrap gap-2">
            {!converted && (
              <Link to={`/quotations/${id}/edit`} className="btn btn-secondary btn-sm">
                <Pencil size={15} /> Edit
              </Link>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={duplicate} disabled={busy}>
              <Copy size={15} /> Duplicate
            </button>
            {!converted && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setConvertOpen(true)} disabled={busy}>
                <ArrowRightLeft size={15} /> Convert to invoice
              </button>
            )}
            {!converted && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                onClick={() => setDeleting(true)}
                disabled={busy}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        }
      />

      {/* Status quick-actions */}
      {!converted && (
        <div className="no-print mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Set status</span>
          {STATUS_ACTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              className={`btn btn-sm ${q.status === a.value ? 'btn-subtle' : 'btn-secondary'}`}
              onClick={() => setStatus(a.value)}
              disabled={busy || q.status === a.value}
            >
              {a.value === 'ACCEPTED' && <CheckCircle2 size={14} />} {a.label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            Current: <StatusBadge status={q.status} kind="quotation" />
          </span>
        </div>
      )}

      {converted && (
        <div className="no-print mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          <Badge className="bg-violet-100 text-violet-700 ring-violet-200">Converted</Badge>
          <span>This quotation was converted to an invoice and is now read-only.</span>
          <Link to="/invoices" className="font-semibold underline">
            Go to invoices →
          </Link>
        </div>
      )}

      <DocumentActions
        kind="QUOTATION"
        id={q.id}
        reference={q.quotationNumber}
        customer={q.customer}
        subjectPrefix="Quotation"
      />

      <DocumentPaper kind="QUOTATION" doc={q} settings={settings} />

      {convertOpen && (
        <ConvertToInvoiceModal
          quotation={q}
          onClose={(invoice) => {
            setConvertOpen(false);
            refresh?.();
            if (invoice) navigate(`/invoices/${invoice.id}`);
            else load();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={remove}
        loading={busy}
        danger
        title="Delete quotation"
        message={`Delete ${q.quotationNumber}? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
