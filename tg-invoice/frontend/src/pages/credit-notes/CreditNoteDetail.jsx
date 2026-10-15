import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, CheckCircle2, Ban, Trash2, ArrowRightLeft, Undo2 } from 'lucide-react';
import api, { apiMessage } from '../../services/api.js';
import { creditNoteApi, refundApi } from '../../services/creditNotes.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, LoadingBlock, ConfirmDialog, StatusBadge, Modal, Button, Field } from '../../components/ui.jsx';
import { DocumentPaper, DocumentActions } from '../../components/documents.jsx';
import Attachments from '../../components/Attachments.jsx';
import CustomFieldsPanel from '../../components/CustomFieldsPanel.jsx';
import { paymentMethodLabel } from '../../utils/status.js';
import { formatDateTime } from '../../utils/dates.js';

export default function CreditNoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { role } = useAuth();
  const { settings, money } = useSettings();
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [cn, setCn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [voidOpen, setVoidOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');

  const [applyOpen, setApplyOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  const load = useCallback(() => {
    creditNoteApi
      .get(id)
      .then((d) => {
        setCn(d);
        setError('');
      })
      .catch((err) => setError(apiMessage(err, 'Could not load the credit note.')))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      load();
      return true;
    } catch (err) {
      toast.error(apiMessage(err, 'Something went wrong.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const doVoid = async () => {
    const ok = await run(() => creditNoteApi.void(id, reason), 'Credit note voided.');
    if (ok) { setVoidOpen(false); setReason(''); }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await creditNoteApi.remove(id);
      toast.success('Draft credit note deleted.');
      navigate('/credit-notes');
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete the credit note.'));
      setDeleteOpen(false);
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading credit note…" />;
  if (error || !cn) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-rose-600">{error || 'Credit note not found.'}</p>
        <Link to="/credit-notes" className="btn btn-secondary btn-sm mx-auto mt-4">
          <ArrowLeft size={15} /> Back to credit notes
        </Link>
      </div>
    );
  }

  const remaining = Number(cn.creditRemaining || 0);
  const applied = Number(cn.amountApplied || 0);
  const isDraft = cn.status === 'DRAFT';
  const isVoid = cn.status === 'VOID';
  const canIssue = isDraft;
  const canApply = !isDraft && !isVoid && remaining > 0.001;
  const canRefund = !isDraft && !isVoid && remaining > 0.001;
  const canVoid = canManage && !isVoid && applied === 0;

  const refunds = cn.refunds || [];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {cn.creditNoteNumber}
            <StatusBadge status={cn.status} kind="creditNote" />
          </span>
        }
        subtitle={`${cn.customer?.companyName || cn.customer?.name || ''} · ${money(cn.total)}${cn.invoice?.invoiceNumber ? ` · against ${cn.invoice.invoiceNumber}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canIssue && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => run(() => creditNoteApi.issue(id), 'Credit note issued.')} disabled={busy}>
                <CheckCircle2 size={15} /> Issue
              </button>
            )}
            {canApply && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setApplyOpen(true)} disabled={busy}>
                <ArrowRightLeft size={15} /> Apply to invoice
              </button>
            )}
            {canRefund && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefundOpen(true)} disabled={busy}>
                <Undo2 size={15} /> Refund
              </button>
            )}
            {isDraft && (
              <Link to={`/credit-notes/${id}/edit`} className="btn btn-secondary btn-sm">
                <Pencil size={15} /> Edit
              </Link>
            )}
            {canVoid && (
              <button type="button" className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50" onClick={() => setVoidOpen(true)} disabled={busy}>
                <Ban size={15} /> Void
              </button>
            )}
            {isDraft && canManage && (
              <button type="button" className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50" onClick={() => setDeleteOpen(true)} disabled={busy} title="Delete draft">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        }
      />

      {!isVoid && (
        <DocumentActions
          kind="CREDIT_NOTE"
          id={cn.id}
          reference={cn.creditNoteNumber}
          customer={cn.customer}
          subjectPrefix="Credit note"
        />
      )}

      <DocumentPaper kind="CREDIT_NOTE" doc={cn} settings={settings} />

      <Attachments documentKind="CREDIT_NOTE" documentId={cn.id} />

      <CustomFieldsPanel entity="CREDIT_NOTE" entityId={cn.id} />

      {applied > 0 && (
        <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-800">
          <span className="font-semibold">{money(applied)}</span> of this credit note has been applied
          {cn.invoice?.invoiceNumber ? ` to invoice ${cn.invoice.invoiceNumber}` : ''}.{' '}
          <span className="font-semibold">{money(remaining)}</span> remains.
        </div>
      )}

      {refunds.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Refunds against this credit note</h2>
          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Refund</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Method</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{r.refundNumber}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{formatDateTime(r.refundDate)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-slate-800">{money(r.amount)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{paymentMethodLabel(r.method)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} kind="refund" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {applyOpen && (
        <ApplyModal
          creditNote={cn}
          onClose={() => setApplyOpen(false)}
          onApplied={() => { setApplyOpen(false); load(); }}
        />
      )}

      {refundOpen && (
        <RefundModal
          creditNote={cn}
          remaining={remaining}
          onClose={() => setRefundOpen(false)}
          onRefunded={() => { setRefundOpen(false); load(); }}
        />
      )}

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={`Void ${cn.creditNoteNumber}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy}>Keep credit note</Button>
            <Button variant="danger" onClick={doVoid} loading={busy}>Void credit note</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-600">
            The credit note keeps its number and stays visible, but stops counting as a customer credit.
            This cannot be undone.
          </p>
          <Field label="Reason (optional)">
            <input className="input" placeholder="e.g. Raised in error" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={doDelete}
        loading={busy}
        danger
        title="Delete draft credit note"
        message={`Delete ${cn.creditNoteNumber} permanently? Only drafts with no applied credit can be deleted.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ── Apply to invoice ─────────────────────────────────────────────── */

function ApplyModal({ creditNote, onClose, onApplied }) {
  const toast = useToast();
  const { money } = useSettings();
  const [invoices, setInvoices] = useState([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const remaining = Number(creditNote.creditRemaining || 0);

  useEffect(() => {
    api
      .get('/invoices', { params: { customerId: creditNote.customerId, limit: 100 } })
      .then(({ data }) => {
        const open = (data.data || []).filter((i) => !['CANCELLED', 'VOID', 'DRAFT'].includes(i.status));
        setInvoices(open);
        const preferred = creditNote.invoice?.id || open[0]?.id || '';
        setInvoiceId(preferred);
      })
      .catch(() => setInvoices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditNote.customerId]);

  const selected = invoices.find((i) => i.id === invoiceId);
  const max = Math.min(remaining, Number(selected?.balanceDue ?? remaining));
  const suggested = max;

  const submit = async (e) => {
    e.preventDefault();
    if (!invoiceId) { toast.error('Select the invoice to apply the credit to.'); return; }
    setBusy(true);
    try {
      const result = await creditNoteApi.apply(creditNote.id, {
        invoiceId,
        amount: amount === '' ? undefined : Number(amount),
      });
      toast.success(`Applied ${money(result.applied)} to ${result.invoice.invoiceNumber}.`);
      onApplied();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not apply the credit note.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Apply credit to an invoice"
      description="Reduce the outstanding balance of an invoice with this credit."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!invoiceId}>Apply credit</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Invoice" required hint={`Available credit: ${money(remaining)}`}>
          <select className="input" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">— Select an invoice —</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoiceNumber} · balance {money(inv.balanceDue)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" hint={`Leave empty to apply the maximum (${money(max)}).`}>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input"
            placeholder={String(suggested)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

/* ── Refund credit as cash ────────────────────────────────────────── */

const REFUND_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'POS', label: 'POS' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'OTHER', label: 'Other' },
];

function RefundModal({ creditNote, remaining, onClose, onRefunded }) {
  const toast = useToast();
  const { money } = useSettings();
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const refund = await refundApi.create({
        customerId: creditNote.customerId,
        creditNoteId: creditNote.id,
        amount: Number(amount),
        method,
        reference,
        reason: `Refund of credit note ${creditNote.creditNoteNumber}`,
      });
      toast.success(`Refund ${refund.refundNumber} recorded.`);
      onRefunded();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not record the refund.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Refund credit note"
      description="Pay the remaining credit back to the customer as cash."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!amount || Number(amount) <= 0}>Record refund</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Refundable credit: <span className="font-semibold text-slate-700">{money(remaining)}</span>
        </p>
        <Field label="Amount" required>
          <input type="number" min="0" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {REFUND_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference (optional)">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer reference…" />
        </Field>
      </form>
    </Modal>
  );
}
