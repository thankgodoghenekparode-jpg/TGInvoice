import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Send, XCircle, Trash2, ReceiptText } from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, LoadingBlock, ConfirmDialog, StatusBadge, Modal, Button, Field, th, td, trHover,
} from '../../components/ui.jsx';
import { DocumentPaper, DocumentActions, RecordPaymentModal } from '../../components/documents.jsx';
import { formatDateTime, formatDate } from '../../utils/dates.js';
import { paymentMethodLabel } from '../../utils/status.js';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, refresh, money } = useSettings();

  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(() => {
    api
      .get(`/invoices/${id}`)
      .then(({ data }) => {
        setInv(data.data);
        setError('');
      })
      .catch((err) => setError(apiMessage(err, 'Could not load the invoice.')))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, successMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      if (successMsg) toast.success(successMsg);
      if (result !== false) load();
    } catch (err) {
      toast.error(apiMessage(err, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  const markSent = () => act(() => api.post(`/invoices/${id}/send`), 'Invoice marked as sent.');

  const cancelInvoice = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/cancel`, { reason: cancelReason });
      toast.success('Invoice cancelled.');
      setCancelOpen(false);
      setCancelReason('');
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not cancel the invoice.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteInvoice = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/invoices/${id}`);
      toast.success(data.data?.message || 'Invoice deleted.');
      navigate('/invoices');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the invoice.'));
      setDeleteOpen(false);
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading invoice…" />;
  if (error || !inv) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-rose-600">{error || 'Invoice not found.'}</p>
        <Link to="/invoices" className="btn btn-secondary btn-sm mt-4 mx-auto">
          <ArrowLeft size={15} /> Back to invoices
        </Link>
      </div>
    );
  }

  const cancelled = inv.status === 'CANCELLED' || inv.status === 'VOID';
  const editable = !cancelled && (inv.amountPaid === 0 || inv.amountPaid == null);
  const canPay = !cancelled && Number(inv.balanceDue) > 0;
  const payments = inv.payments || [];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {inv.invoiceNumber}
            <StatusBadge status={inv.status} />
          </span>
        }
        subtitle={`${inv.customer?.companyName || inv.customer?.name || ''} · due ${inv.dueDate ? formatDate(inv.dueDate) : '—'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canPay && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPayOpen(true)} disabled={busy}>
                <Plus size={15} /> Record payment
              </button>
            )}
            {editable && (
              <Link to={`/invoices/${id}/edit`} className="btn btn-secondary btn-sm">
                <Pencil size={15} /> Edit
              </Link>
            )}
            {!cancelled && !canPay && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={markSent} disabled={busy}>
                <Send size={15} /> Mark sent
              </button>
            )}
            {!cancelled && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                  onClick={() => setCancelOpen(true)}
                  disabled={busy}
                  title="Cancel invoice"
                >
                  <XCircle size={15} /> Cancel
                </button>
                {inv.status === 'DRAFT' && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => setDeleteOpen(true)}
                    disabled={busy}
                    title="Delete draft"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        }
      />

      <DocumentActions
        kind="INVOICE"
        id={inv.id}
        reference={inv.invoiceNumber}
        customer={inv.customer}
        subjectPrefix="Invoice"
      />

      <DocumentPaper kind="INVOICE" doc={inv} settings={settings} />

      {/* Payments */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ReceiptText size={16} className="text-slate-400" /> Payments
            {payments.length > 0 && <span className="text-slate-400">({payments.length})</span>}
          </h2>
          {canPay && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPayOpen(true)} disabled={busy}>
              <Plus size={15} /> Record payment
            </button>
          )}
        </div>

        <div className="card overflow-hidden">
          {payments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              No payments yet. {canPay ? `Outstanding balance: ${money(inv.balanceDue)}.` : ''}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={th}>Date</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}>Method</th>
                    <th className={th}>Reference</th>
                    <th className={th}>Recorded by</th>
                    <th className={th}>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className={trHover}>
                      <td className={`${td} whitespace-nowrap`}>{formatDateTime(p.paymentDate)}</td>
                      <td className={`${td} text-right font-semibold text-emerald-700`}>{money(p.amount)}</td>
                      <td className={td}>{paymentMethodLabel(p.paymentMethod)}</td>
                      <td className={`${td} text-slate-500`}>{p.reference || '—'}</td>
                      <td className={td}>{p.createdBy?.name || '—'}</td>
                      <td className={td}>
                        {p.receipt ? (
                          <Link to={`/receipts/${p.receipt.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                            {p.receipt.receiptNumber}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {payOpen && (
        <RecordPaymentModal
          invoice={inv}
          onClose={() => setPayOpen(false)}
          onRecorded={() => {
            load(); // pull the recalculated totals, status and new payment row
            refresh?.();
          }}
        />
      )}

      {/* Cancel modal */}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${inv.invoiceNumber}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy}>
              Keep invoice
            </Button>
            <Button variant="danger" onClick={cancelInvoice} loading={busy}>
              Cancel invoice
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-600">
            The invoice keeps its number and remains visible for audit purposes, but it stops counting
            towards your totals. This cannot be undone.
          </p>
          <Field label="Reason (optional)">
            <input
              className="input"
              placeholder="e.g. Issued in error"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteInvoice}
        loading={busy}
        danger
        title="Delete draft invoice"
        message={`Delete ${inv.invoiceNumber} permanently? Only drafts with no payments can be deleted.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
