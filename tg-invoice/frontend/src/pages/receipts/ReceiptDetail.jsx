import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban } from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PageHeader, LoadingBlock, StatusBadge, Modal, Button, Field,
} from '../../components/ui.jsx';
import { DocumentPaper, DocumentActions } from '../../components/documents.jsx';
import Attachments from '../../components/Attachments.jsx';

export default function ReceiptDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { settings, refresh } = useSettings();

  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    api
      .get(`/receipts/${id}`)
      .then(({ data }) => {
        setReceipt(data.data);
        setError('');
      })
      .catch((err) => setError(apiMessage(err, 'Could not load the receipt.')))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const voidReceipt = async () => {
    setBusy(true);
    try {
      await api.post(`/receipts/${id}/void`, { reason });
      toast.success('Receipt voided.');
      setVoidOpen(false);
      setReason('');
      refresh?.();
      load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not void the receipt.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading receipt…" />;
  if (error || !receipt) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-rose-600">{error || 'Receipt not found.'}</p>
        <Link to="/receipts" className="btn btn-secondary btn-sm mt-4 mx-auto">
          <ArrowLeft size={15} /> Back to receipts
        </Link>
      </div>
    );
  }

  const isVoid = receipt.status === 'VOID';

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {receipt.receiptNumber}
            <StatusBadge status={receipt.status} />
          </span>
        }
        subtitle={
          receipt.invoice?.invoiceNumber
            ? `Payment for invoice ${receipt.invoice.invoiceNumber}`
            : 'Payment received'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {receipt.invoice && (
              <Link to={`/invoices/${receipt.invoice.id}`} className="btn btn-secondary btn-sm">
                View invoice
              </Link>
            )}
            {!isVoid && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                onClick={() => setVoidOpen(true)}
                disabled={busy}
              >
                <Ban size={15} /> Void receipt
              </button>
            )}
          </div>
        }
      />

      {isVoid && (
        <div className="no-print mb-5 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-3 text-sm text-slate-600">
          This receipt has been voided{receipt.voidReason ? ` — ${receipt.voidReason}` : ''}. It stays visible for
          audit purposes but no longer counts towards your totals.
        </div>
      )}

      {!isVoid && (
        <DocumentActions
          kind="RECEIPT"
          id={receipt.id}
          reference={receipt.receiptNumber}
          customer={receipt.customer}
          subjectPrefix="Receipt"
        />
      )}

      <DocumentPaper kind="RECEIPT" doc={receipt} settings={settings} />

      <Attachments documentKind="RECEIPT" documentId={receipt.id} />

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={`Void ${receipt.receiptNumber}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy}>
              Keep receipt
            </Button>
            <Button variant="danger" onClick={voidReceipt} loading={busy}>
              Void receipt
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-600">
            Voiding marks the receipt as invalid while keeping it on record. The underlying payment stays in the
            invoice history. This cannot be undone.
          </p>
          <Field label="Reason (optional)">
            <input
              className="input"
              placeholder="e.g. Duplicate payment"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
