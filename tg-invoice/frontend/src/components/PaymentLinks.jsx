import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiMessage } from '../services/api.js';
import {
  cancelPaymentLink, createPaymentLink, listPaymentLinks, verifyPaymentLink,
} from '../services/payments.js';
import { track, EVENTS } from '../services/events.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  Badge, Button, ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, th, td, trHover,
} from './ui.jsx';
import { formatDateTime } from '../utils/dates.js';

/**
 * Online payment links for one invoice.
 *
 * A link is a hosted checkout page (Paystack/Flutterwave) that charges the
 * outstanding balance. When the customer pays, the gateway webhook settles the
 * invoice automatically — this panel is where you create, share and check
 * those links, not where money is recorded by hand.
 */

const STATUS = {
  PENDING: { label: 'Awaiting payment', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  SUCCEEDED: { label: 'Paid', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  FAILED: { label: 'Failed', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  ABANDONED: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

const providerLabel = (p) => (p === 'flutterwave' ? 'Flutterwave' : 'Paystack');

export default function PaymentLinks({ invoice, onSettled }) {
  const toast = useToast();
  const { money } = useSettings();

  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [shared, setShared] = useState(null);
  const [toCancel, setToCancel] = useState(null);

  const outstanding = Number(invoice.balanceDue) || 0;
  const canCreate = outstanding > 0 && !['DRAFT', 'CANCELLED', 'VOID'].includes(invoice.status);

  const load = useCallback(async () => {
    try {
      setLinks(await listPaymentLinks(invoice.id));
    } catch (err) {
      toast.error(apiMessage(err, 'Could not load payment links.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Payment link copied — paste it into WhatsApp, email or SMS.');
    } catch {
      toast.error('Copy the link from the field instead.');
    }
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const intent = await createPaymentLink(invoice.id, amount === '' ? {} : { amount: Number(amount) });
      track(EVENTS.PAYMENT_LINK_CREATED, { provider: intent.provider, partial: amount !== '' });
      setCreateOpen(false);
      setAmount('');
      setShared(intent);
      await load();
    } catch (err) {
      // A deployment without gateway keys answers with a "not enabled" 400 —
      // the message is the fix, so show it verbatim.
      toast.error(apiMessage(err, 'Could not create a payment link.'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (intent) => {
    setBusyId(intent.id);
    try {
      const { verification } = await verifyPaymentLink(invoice.id, intent.id);
      await load();
      if (verification?.paid) {
        toast.success('Payment confirmed — the invoice has been updated.');
        onSettled?.();
      } else {
        toast.info(verification?.message || 'Not paid yet. The link stays open.');
      }
    } catch (err) {
      toast.error(apiMessage(err, 'Could not check that link.'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmCancel = async () => {
    if (!toCancel) return;
    setBusy(true);
    try {
      await cancelPaymentLink(invoice.id, toCancel.id);
      toast.success('Payment link cancelled.');
      setToCancel(null);
      await load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not cancel that link.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Link2 size={16} className="text-slate-400" /> Payment links
          {links.length > 0 && <span className="text-slate-400">({links.length})</span>}
        </h2>
        {canCreate && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { setAmount(''); setCreateOpen(true); }}
            disabled={busy}
          >
            <Plus size={15} /> New payment link
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <LoadingBlock label="Loading payment links…" />
        ) : links.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              icon={Link2}
              title="No payment links yet"
              description={
                canCreate
                  ? `Create a link for ${money(outstanding)} and send it to your customer — they pay by card or transfer, and the invoice settles itself.`
                  : 'Payment links can be created while an invoice has an outstanding balance.'
              }
              action={
                canCreate ? (
                  <Button size="sm" onClick={() => { setAmount(''); setCreateOpen(true); }}>
                    <Plus size={15} /> Create a payment link
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className={th}>Created</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Gateway</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => {
                  const status = STATUS[link.status] || STATUS.ABANDONED;
                  return (
                    <tr key={link.id} className={trHover}>
                      <td className={`${td} whitespace-nowrap text-slate-500`}>{formatDateTime(link.createdAt)}</td>
                      <td className={`${td} text-right font-semibold`}>{money(link.amount)}</td>
                      <td className={td}>{providerLabel(link.provider)}</td>
                      <td className={td}>
                        <Badge className={status.className}>{status.label}</Badge>
                      </td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        {link.status === 'PENDING' ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setShared(link)}
                              title="Show the checkout link"
                            >
                              <Copy size={14} /> Link
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => verify(link)}
                              disabled={busyId === link.id}
                              title="Check with the gateway now"
                            >
                              <RefreshCw size={14} className={busyId === link.id ? 'animate-spin' : ''} /> Check
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                              onClick={() => setToCancel(link)}
                              disabled={busy}
                              title="Cancel this link"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {link.status === 'SUCCEEDED' ? `Paid ${link.paidAt ? formatDateTime(link.paidAt) : ''}` : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create */}
      <Modal
        open={createOpen}
        onClose={() => (busy ? null : setCreateOpen(false))}
        title={`New payment link · ${invoice.invoiceNumber}`}
        size="sm"
        description="Your customer opens the link and pays by card, bank transfer or USSD. The invoice settles automatically once the gateway confirms the payment."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitCreate} loading={busy}>
              Create link
            </Button>
          </>
        }
      >
        <form onSubmit={submitCreate} className="space-y-4">
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Outstanding balance</span>
              <span className="font-semibold text-rose-600">{money(outstanding)}</span>
            </div>
          </div>
          <Field
            label="Amount to charge"
            hint={`Leave as is to charge the full balance of ${money(outstanding)}.`}
          >
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={outstanding || undefined}
              className="input"
              placeholder={String(outstanding)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </form>
      </Modal>

      {/* Share */}
      <Modal
        open={!!shared}
        onClose={() => setShared(null)}
        title="Payment link ready"
        size="sm"
        description="Send this to your customer. Anyone with the link can pay — the amount is fixed to this invoice."
        footer={
          <>
            <Button variant="secondary" onClick={() => setShared(null)}>
              Close
            </Button>
            <Button onClick={() => copy(shared?.checkoutUrl)} disabled={!shared?.checkoutUrl}>
              <Copy size={15} /> Copy link
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input className="input font-mono text-xs" readOnly value={shared?.checkoutUrl || ''} />
            {shared?.checkoutUrl && (
              <a
                href={shared.checkoutUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm shrink-0"
                title="Open the checkout page"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {money(shared?.amount)} via {providerLabel(shared?.provider)}. We mark the invoice paid the moment
            the gateway confirms it — you can also press <span className="font-medium">Check</span> in the list
            to confirm immediately.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => (busy ? null : setToCancel(null))}
        onConfirm={confirmCancel}
        title="Cancel this payment link?"
        message="The customer will no longer be able to pay through this link. You can always create a new one."
        confirmLabel="Cancel link"
        danger
        loading={busy}
      />
    </section>
  );
}
