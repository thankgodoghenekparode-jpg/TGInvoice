import { useEffect, useState } from 'react';
import { Plus, Search, Undo2, Ban } from 'lucide-react';
import clsx from 'clsx';
import api, { apiMessage } from '../../services/api.js';
import { refundApi } from '../../services/creditNotes.js';
import { usePagedList, useDebounced } from '../../hooks/useList.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../hooks/useSettings.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/dates.js';
import { paymentMethodLabel } from '../../utils/status.js';
import {
  PageHeader, StatusBadge, Select, Button, Field, Modal, EmptyState, LoadingBlock, Pagination, th, td, trHover,
} from '../../components/ui.jsx';

const REFUND_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'POS', label: 'POS' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'OTHER', label: 'Other' },
];

/** Refunds — cash paid back to customers. */
export default function RefundsPage() {
  const toast = useToast();
  const { role } = useAuth();
  const { money } = useSettings();
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debounced = useDebounced(search);
  const { rows, meta, page, setPage, loading, error, reload } = usePagedList('/refunds', {
    search: debounced,
    status,
  });

  const [newOpen, setNewOpen] = useState(false);
  const [toVoid, setToVoid] = useState(null);
  const [busy, setBusy] = useState(false);

  const doVoid = async () => {
    if (!toVoid) return;
    setBusy(true);
    try {
      await refundApi.void(toVoid.id, 'Voided');
      toast.success(`Refund ${toVoid.refundNumber} voided.`);
      setToVoid(null);
      reload();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not void the refund.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Refunds"
        subtitle="Money paid back to customers — from a credit note, an invoice or a specific payment."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus size={15} /> New refund
          </Button>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search refunds…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOID">Void</option>
          </Select>
          {meta.totalRefunded != null && (
            <span className="ml-auto text-xs text-slate-500">
              Total refunded: <span className="font-semibold text-slate-700">{money(meta.totalRefunded)}</span>
            </span>
          )}
        </div>

        {loading ? (
          <LoadingBlock label="Loading refunds…" />
        ) : error ? (
          <EmptyState title="Could not load refunds" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Undo2}
            title={debounced || status ? 'No refunds match your filters' : 'No refunds yet'}
            description={
              debounced || status
                ? 'Try a different search term or status.'
                : 'Record a refund when you pay money back from a credit note, an invoice or a payment.'
            }
            action={
              <Button size="sm" onClick={() => setNewOpen(true)}>
                <Plus size={15} /> New refund
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Refund</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Source</th>
                  <th className={th}>Date</th>
                  <th className={clsx(th, 'text-right')}>Amount</th>
                  <th className={th}>Method</th>
                  <th className={th}>Status</th>
                  {canManage && <th className={clsx(th, 'text-right')}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={trHover}>
                    <td className={td}>
                      <span className="font-medium text-slate-800">{r.refundNumber}</span>
                    </td>
                    <td className={td}>{r.customer?.companyName || r.customer?.name || '—'}</td>
                    <td className={clsx(td, 'text-slate-500')}>
                      {r.creditNote?.creditNoteNumber || r.invoice?.invoiceNumber || (r.payment ? 'Direct payment' : '—')}
                    </td>
                    <td className={td}>{formatDate(r.refundDate)}</td>
                    <td className={clsx(td, 'text-right font-semibold text-slate-800')}>{money(r.amount)}</td>
                    <td className={td}>{paymentMethodLabel(r.method)}</td>
                    <td className={td}>
                      <StatusBadge status={r.status} kind="refund" />
                    </td>
                    {canManage && (
                      <td className={td}>
                        <div className="flex items-center justify-end">
                          {r.status === 'COMPLETED' && (
                            <button
                              type="button"
                              title="Void this refund"
                              onClick={() => setToVoid(r)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Ban size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <Pagination page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} label="refunds" />
        )}
      </div>

      {newOpen && (
        <NewRefundModal
          onClose={() => setNewOpen(false)}
          onCreated={() => { setNewOpen(false); reload(); }}
        />
      )}

      <Modal
        open={Boolean(toVoid)}
        onClose={() => setToVoid(null)}
        title={`Void ${toVoid?.refundNumber || 'refund'}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setToVoid(null)} disabled={busy}>Keep refund</Button>
            <Button variant="danger" onClick={doVoid} loading={busy}>Void refund</Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">
          Voiding a refund keeps the record for audit, but releases the amount back to its source so it can be
          refunded again. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

/* ── New refund ───────────────────────────────────────────────────── */

function NewRefundModal({ onClose, onCreated }) {
  const toast = useToast();
  const { money } = useSettings();
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [creditNotes, setCreditNotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [source, setSource] = useState('creditNote');
  const [creditNoteId, setCreditNoteId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/customers', { params: { limit: 100, sort: 'name' } })
      .then(({ data }) => setCustomers(data.data || []))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (!customerId) { setCreditNotes([]); setInvoices([]); return; }
    api.get('/credit-notes', { params: { customerId, limit: 100 } })
      .then(({ data }) => setCreditNotes((data.data || []).filter((c) => c.status !== 'DRAFT' && c.status !== 'VOID' && c.creditRemaining > 0)))
      .catch(() => setCreditNotes([]));
    api.get('/invoices', { params: { customerId, limit: 100 } })
      .then(({ data }) => setInvoices((data.data || []).filter((i) => Number(i.amountPaid) > 0)))
      .catch(() => setInvoices([]));
  }, [customerId]);

  const selectedCn = creditNotes.find((c) => c.id === creditNoteId);
  const selectedInv = invoices.find((i) => i.id === invoiceId);
  const max = source === 'creditNote' ? Number(selectedCn?.creditRemaining || 0) : Number(selectedInv?.amountPaid || 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!customerId) { toast.error('Select a customer.'); return; }
    if (source === 'creditNote' && !creditNoteId) { toast.error('Select the credit note to refund.'); return; }
    if (source === 'invoice' && !invoiceId) { toast.error('Select the invoice to refund.'); return; }
    setBusy(true);
    try {
      const refund = await refundApi.create({
        customerId,
        amount: Number(amount),
        method,
        reference,
        reason,
        ...(source === 'creditNote' ? { creditNoteId } : { invoiceId }),
      });
      toast.success(`Refund ${refund.refundNumber} recorded.`);
      onCreated();
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
      title="New refund"
      description="Pay money back to a customer. The amount is capped by what is still refundable on the source."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!customerId || !amount || Number(amount) <= 0}>Record refund</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Customer" required>
          <select className="input" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setCreditNoteId(''); setInvoiceId(''); setAmount(''); }}>
            <option value="">— Select a customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.companyName || c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Refund from" required hint="Credit notes hold customer credit; invoices hold cash already received.">
          <Select value={source} onChange={(e) => { setSource(e.target.value); setAmount(''); }}>
            <option value="creditNote">A credit note</option>
            <option value="invoice">An invoice</option>
          </Select>
        </Field>

        {source === 'creditNote' ? (
          <Field label="Credit note" required hint={selectedCn ? `Refundable: ${money(selectedCn.creditRemaining)}` : undefined}>
            <select className="input" value={creditNoteId} onChange={(e) => { setCreditNoteId(e.target.value); setAmount(''); setAmount(String(creditNotes.find((c) => c.id === e.target.value)?.creditRemaining || '')); }} disabled={!customerId}>
              <option value="">— Select a credit note —</option>
              {creditNotes.map((c) => (
                <option key={c.id} value={c.id}>{c.creditNoteNumber} · {money(c.creditRemaining)} available</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Invoice" required hint={selectedInv ? `Received: ${money(selectedInv.amountPaid)}` : undefined}>
            <select className="input" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setAmount(String(invoices.find((i) => i.id === e.target.value)?.amountPaid || '')); }} disabled={!customerId}>
              <option value="">— Select an invoice —</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>{i.invoiceNumber} · {money(i.amountPaid)} received</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Amount" required hint={max > 0 ? `Maximum ${money(max)}` : undefined}>
          <input type="number" min="0" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Method">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {REFUND_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference (optional)">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>

        <Field label="Reason (optional)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer cancelled the order" />
        </Field>
      </form>
    </Modal>
  );
}
