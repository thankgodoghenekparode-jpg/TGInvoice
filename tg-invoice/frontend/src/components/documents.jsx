import { useEffect, useState } from 'react';
import { Download, Printer, Share2, Mail, X, Plus, AlertTriangle, ArrowRightLeft, Send, MessageCircle, Smartphone } from 'lucide-react';
import { api, apiMessage, apiFieldErrors } from '../services/api.js';
import { downloadPdf, printPdf } from '../services/files.js';
import { shareDocument, pdfFileName } from '../services/share.js';
import { getMessagingStatus, deliverDocument } from '../services/messaging.js';
import { formatMoney, amountInWords } from '../utils/currency.js';
import { formatDate } from '../utils/dates.js';
import { PAYMENT_METHODS, paymentMethodLabel } from '../utils/status.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../context/ToastContext.jsx';
import { Modal, Field } from './ui.jsx';

const KIND_PLURAL = { QUOTATION: 'quotations', INVOICE: 'invoices', RECEIPT: 'receipts' };
const KIND_TITLE = { QUOTATION: 'QUOTATION', INVOICE: 'INVOICE', RECEIPT: 'RECEIPT' };

/* ── normalizer: API entity → paper model (mirrors the PDF service) ── */
function toPaper(kind, doc, settings) {
  const money = (v) => formatMoney(v, settings);
  const customer = doc.customer || {};

  if (kind === 'RECEIPT') {
    return {
      type: kind,
      reference: doc.receiptNumber,
      date: doc.receiptDate,
      dateLabel: 'Receipt Date',
      extraMeta: [['Reference', doc.reference || doc.payment?.reference || '—']],
      status: doc.status,
      customer,
      sideLines: [
        { label: 'AMOUNT RECEIVED', value: money(doc.amount), big: true, color: '#16A34A' },
        { label: 'PAYMENT METHOD', value: paymentMethodLabel(doc.paymentMethod) },
      ],
      detailRows: [
        ['Invoice', doc.invoice?.invoiceNumber || '—'],
        ['Payment Date', formatDate(doc.payment?.paymentDate || doc.receiptDate)],
        ['Payment Method', paymentMethodLabel(doc.paymentMethod)],
        ['Reference', doc.reference || doc.payment?.reference || '—'],
        ['Description', doc.description || `Payment for invoice ${doc.invoice?.invoiceNumber || ''}`.trim()],
        ['Recorded by', doc.createdBy?.name || '—'],
      ],
      totals: {
        label: 'AMOUNT',
        rows: [],
        total: doc.amount,
        showPaidBalance: false,
      },
      words: amountInWords(doc.amount, settings),
      notes: doc.notes || settings.defaultReceiptNotes || '',
      terms: '',
      paymentInfo: true,
      items: null,
    };
  }

  const isInvoice = kind === 'INVOICE';
  const items = (doc.items || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      discountAmount: Number(it.discountAmount || 0),
      taxAmount: Number(it.taxAmount || 0),
      amount: Number(it.amount),
    }));

  return {
    type: kind,
    reference: isInvoice ? doc.invoiceNumber : doc.quotationNumber,
    date: isInvoice ? doc.invoiceDate : doc.quotationDate,
    dateLabel: isInvoice ? 'Invoice Date' : 'Quotation Date',
    extraMeta: isInvoice
      ? [['Due Date', formatDate(doc.dueDate)], ['Reference', doc.reference || '—']]
      : [['Valid Until', formatDate(doc.validUntil)], ['Reference', doc.reference || '—']],
    status: doc.status,
    customer,
    sideLines: isInvoice
      ? [
          {
            label: 'AMOUNT DUE',
            value: money(doc.balanceDue),
            big: true,
            color: Number(doc.balanceDue) > 0 ? '#DC2626' : '#16A34A',
          },
          { label: 'DUE DATE', value: formatDate(doc.dueDate) || '—' },
        ]
      : [
          { label: 'TOTAL', value: money(doc.total), big: true, color: '#2563EB' },
          { label: 'VALID UNTIL', value: formatDate(doc.validUntil) || '—' },
        ],
    detailRows: null,
    totals: {
      label: 'TOTAL',
      rows: [
        ['Subtotal', money(doc.subtotal)],
        ...(Number(doc.discountAmount) > 0 ? [['Discount', `-${money(doc.discountAmount)}`]] : []),
        ...(Number(doc.taxAmount) > 0 ? [['Tax', money(doc.taxAmount)]] : []),
      ],
      total: doc.total,
      showPaidBalance: isInvoice,
      amountPaid: Number(doc.amountPaid || 0),
      balanceDue: Number(doc.balanceDue ?? doc.total),
      paidLabel: 'Amount Paid',
      balanceLabel: 'Balance Due',
      money,
    },
    words: null,
    notes: doc.notes || (isInvoice ? settings.defaultInvoiceNotes : settings.defaultQuotationTerms) || '',
    terms: isInvoice
      ? doc.terms || ''
      : doc.terms || settings.defaultQuotationTerms || '',
    paymentInfo: true,
    items,
    money,
  };
}

function customerLines(c) {
  const lines = [];
  if (c.companyName && c.companyName !== c.name) lines.push(c.companyName);
  if (c.email) lines.push(c.email);
  if (c.phone) lines.push(c.phone);
  if (c.address) lines.push(c.address);
  const locality = [c.city, c.state, c.country].filter(Boolean).join(', ');
  if (locality) lines.push(locality);
  if (c.taxId) lines.push(`Tax ID: ${c.taxId}`);
  if (c.customerCode) lines.push(`Customer code: ${c.customerCode}`);
  return lines;
}

/* ── Document paper — HTML replica of the server-generated PDF ────── */

export function DocumentPaper({ kind, doc, settings = {} }) {
  const { activeTenant } = useAuth();
  const p = toPaper(kind, doc, settings);
  const money = (v) => formatMoney(v, settings);
  const businessName = settings.businessName || activeTenant?.name || 'Your Business';
  const hasBank = settings.bankName || settings.accountName || settings.accountNumber;

  const accent = kind === 'QUOTATION' ? 'text-amber-600' : kind === 'RECEIPT' ? 'text-emerald-600' : 'text-brand-600';

  return (
    <article className="print-area mx-auto w-full max-w-[820px] rounded-lg bg-white p-10 text-slate-900 shadow-sm ring-1 ring-line print:mx-0 print:rounded-none print:p-0 print:ring-0 print:shadow-none">
      {/* Header */}
      <header className="flex items-start justify-between gap-8 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          {settings.logo ? (
            <img src={settings.logo} alt="" className="h-14 w-14 rounded object-contain" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-brand text-xl font-bold text-white">
              {(businessName || 'T').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 text-[11px] leading-5 text-slate-500">
            <p className="text-base font-bold text-slate-900">{businessName}</p>
            {settings.address && <p className="whitespace-pre-line text-slate-500">{settings.address}</p>}
            {[settings.phone, settings.email, settings.website].filter(Boolean).join('  |  ') && (
              <p>{[settings.phone, settings.email, settings.website].filter(Boolean).join('  |  ')}</p>
            )}
            {settings.taxId && <p>Tax ID: {settings.taxId}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-2xl font-black tracking-tight ${accent}`}>{KIND_TITLE[kind]}</p>
          <p className="mt-1 text-sm font-bold">{p.reference}</p>
          <p className="text-[11px] text-slate-500">{p.dateLabel}: {formatDate(p.date)}</p>
          {p.extraMeta
            .filter(([, v]) => v && v !== '—')
            .map(([label, value]) => (
              <p key={label} className="text-[11px] text-slate-500">
                {label}: {value}
              </p>
            ))}
        </div>
      </header>
      <div className="border-t border-slate-200" />

      {/* Bill to + side box */}
      <section className="mt-5 flex items-start justify-between gap-6">
        <div className="min-w-0 text-[11px]">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Bill to</p>
          <p className="text-sm font-bold text-slate-900">{p.customer?.name || '—'}</p>
          {customerLines(p.customer).map((line) => (
            <p key={line} className="text-slate-500">{line}</p>
          ))}
        </div>
        <div className="w-48 shrink-0 rounded bg-slate-50 p-3">
          {p.sideLines.map((s) => (
            <div key={s.label} className="mb-2 last:mb-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{s.label}</p>
              <p
                className={`${s.big ? 'text-lg' : 'text-sm'} font-bold`}
                style={s.color ? { color: s.color } : undefined}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Line items OR receipt payment details */}
      {p.items ? (
        <section className="mt-6 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit Price</th>
                <th className="px-3 py-2 text-right">Discount</th>
                <th className="px-3 py-2 text-right">Tax</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((it, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2.5 font-medium text-slate-800">{it.description}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{it.quantity}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{money(it.unitPrice)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">
                    {it.discountAmount > 0 ? `-${money(it.discountAmount)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{it.taxAmount > 0 ? money(it.taxAmount) : '—'}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{money(it.amount)}</td>
                </tr>
              ))}
              {!p.items.length && (
                <tr className="border-b border-slate-100">
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-400">No line items.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="mt-6">
          <p className="rounded bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Payment details
          </p>
          <table className="mt-1 w-full text-[11px]">
            <tbody>
              {p.detailRows.map(([label, value]) => (
                <tr key={label} className="border-b border-slate-100">
                  <td className="w-36 py-1.5 pr-3 font-bold text-slate-400">{label}</td>
                  <td className="py-1.5 text-slate-700">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 rounded bg-emerald-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Amount received</p>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-2xl font-black text-emerald-700">{money(p.totals.total)}</p>
              <p className="text-[11px] italic text-slate-500">In words: {p.words}</p>
            </div>
          </div>
        </section>
      )}

      {/* Totals + payment info */}
      <section className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="w-72 max-w-full rounded bg-slate-50 p-4 text-[11px]">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Payment information</p>
          {hasBank && (
            <div className="space-y-0.5 text-slate-700">
              {settings.bankName && <p>Bank: {settings.bankName}</p>}
              {settings.accountName && <p>Account Name: {settings.accountName}</p>}
              {settings.accountNumber && <p>Account Number: {settings.accountNumber}</p>}
            </div>
          )}
          {settings.paymentInstructions && (
            <p className="mt-1.5 whitespace-pre-line text-[10px] text-slate-500">{settings.paymentInstructions}</p>
          )}
          {!hasBank && !settings.paymentInstructions && (
            <p className="text-[10px] text-slate-400">Add bank details in Settings → Documents so clients know where to pay.</p>
          )}
        </div>

        <table className="w-64 max-w-full text-[11px]">
          <tbody>
            {p.totals.rows.map(([label, value]) => (
              <tr key={label}>
                <td className="py-1 text-slate-500">{label}</td>
                <td className="py-1 text-right font-medium text-slate-800">{value}</td>
              </tr>
            ))}
            <tr className="bg-brand-50">
              <td className="px-2 py-2 font-bold text-brand-700">{p.totals.label}</td>
              <td className="px-2 py-2 text-right text-lg font-black text-brand-700">{money(p.totals.total)}</td>
            </tr>
            {p.totals.showPaidBalance && (
              <>
                {p.totals.amountPaid > 0 && (
                  <tr>
                    <td className="py-1 text-slate-500">{p.totals.paidLabel}</td>
                    <td className="py-1 text-right font-medium text-slate-800">{money(p.totals.amountPaid)}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-1 font-bold text-slate-900">{p.totals.balanceLabel}</td>
                  <td
                    className="py-1 text-right text-sm font-bold"
                    style={{ color: p.totals.balanceDue > 0 ? '#DC2626' : '#16A34A' }}
                  >
                    {money(p.totals.balanceDue)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </section>

      {/* Notes + terms */}
      {(p.notes || p.terms) && (
        <section className="mt-6 space-y-3 text-[11px]">
          {p.notes && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Notes</p>
              <p className="whitespace-pre-line text-slate-600">{p.notes}</p>
            </div>
          )}
          {p.terms && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Terms &amp; conditions</p>
              <p className="whitespace-pre-line text-slate-600">{p.terms}</p>
            </div>
          )}
        </section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[10px] text-slate-400">
        <p>Thank you for doing business with {businessName}.</p>
        <p className="mt-0.5">TG Invoice — tgeasy</p>
      </footer>
    </article>
  );
}

/* ── Action bar: Download / Print / Share / Email / Close ─────────── */

export function DocumentActions({ kind, id, reference, customer, subjectPrefix, onClose }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { activeTenant } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const [share, setShare] = useState(null);
  const base = KIND_PLURAL[kind];

  // Pre-fetch the message + public link so the fallback path can act
  // synchronously when that is all the browser supports.
  useEffect(() => {
    if (!activeTenant?.id) return undefined;
    let alive = true;
    api
      .get(`${base}/${id}/share`, { headers: { 'X-Tenant-Id': activeTenant.id } })
      .then(({ data }) => { if (alive) setShare(data.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [base, id, activeTenant?.id]);

  const handleDownload = async () => {
    try {
      await downloadPdf(`${base}/${id}/pdf`, `${reference}.pdf`);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not download the PDF.'));
    }
  };

  const handlePrint = async () => {
    try {
      await printPdf(`${base}/${id}/pdf`);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not open the printable PDF.'));
    }
  };

  /**
   * Share the document itself. The Web Share API hands the PDF to the OS share
   * sheet (WhatsApp, Mail, Drive…) where supported; elsewhere it opens WhatsApp
   * with the message + link and saves the PDF for manual attachment.
   */
  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      let payload = share;
      if (!payload) {
        try {
          const { data } = await api.get(`${base}/${id}/share`, { headers: { 'X-Tenant-Id': activeTenant.id } });
          payload = data.data;
          setShare(payload);
        } catch {
          payload = null; // sharing the PDF can still succeed without the link
        }
      }

      const result = await shareDocument({
        pdfPath: `${base}/${id}/pdf`,
        fileName: pdfFileName(reference),
        title: `${subjectPrefix || kind} ${reference}`,
        text: payload?.text || `Please find ${(subjectPrefix || kind).toLowerCase()} ${reference} attached.`,
        previewUrl: payload?.previewUrl,
        whatsappUrl: payload?.url,
      });

      if (result === 'whatsapp') {
        toast.info('The PDF was saved — attach it in WhatsApp to send the file itself.', 'Share');
      }
    } catch (err) {
      toast.error(apiMessage(err, 'Could not share the document.'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="no-print mb-5 flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-secondary btn-sm" onClick={handleDownload}>
        <Download size={15} /> Download PDF
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={handlePrint}>
        <Printer size={15} /> Print
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={handleShare}
        disabled={sharing}
        title="Share the PDF — pick WhatsApp, email or any app"
      >
        <Share2 size={15} /> {sharing ? 'Sharing…' : 'Share'}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEmailOpen(true)}>
        <Mail size={15} /> Email
      </button>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => setSendOpen(true)}
        title="Send automatically via WhatsApp, SMS or email"
      >
        <Send size={15} /> Send
      </button>
      {onClose && (
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>
          <X size={15} /> Close
        </button>
      )}
      {emailOpen && (
        <EmailModal
          kind={kind}
          id={id}
          reference={reference}
          customer={customer}
          subjectPrefix={subjectPrefix}
          defaultSubject={`${reference} from ${settings.businessName || activeTenant?.name || 'TG Invoice'}`}
          onClose={() => setEmailOpen(false)}
        />
      )}
      {sendOpen && (
        <SendModal
          kind={kind}
          id={id}
          reference={reference}
          customer={customer}
          businessName={settings.businessName || activeTenant?.name}
          defaultMessage={share?.text}
          onClose={() => setSendOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Email modal ──────────────────────────────────────────────────── */

export function EmailModal({ kind, id, reference, customer, defaultSubject, onClose }) {
  const { activeTenant } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    to: customer?.email || '',
    subject: defaultSubject || `${reference}`,
    message: `Please find ${kind === 'QUOTATION' ? 'quotation' : kind === 'RECEIPT' ? 'receipt' : 'invoice'} ${reference} attached. Let me know if you have any questions.`,
  });
  const [errors, setErrors] = useState({});
  const base = KIND_PLURAL[kind];

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.post(`${base}/${id}/email`, form, { headers: { 'X-Tenant-Id': activeTenant.id } });
      toast.success(`Email sent to ${form.to}.`);
      onClose();
    } catch (err) {
      if (err.response?.status === 503) {
        toast.info(apiMessage(err), 'Email not configured');
      } else {
        toast.error(apiMessage(err, 'Could not send the email.'));
        setErrors(apiFieldErrors(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Email ${reference}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="To" error={errors.to} required>
          <input
            type="email"
            className="input"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            required
          />
        </Field>
        <Field label="Subject" error={errors.subject} required>
          <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
        </Field>
        <Field label="Message" error={errors.message} hint="The PDF is attached automatically.">
          <textarea rows={5} className="input" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Mail size={15} /> {busy ? 'Sending…' : 'Send email'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Send modal (WhatsApp / SMS / email, server-side delivery) ─────── */

const CHANNEL_META = {
  WHATSAPP: { label: 'WhatsApp', icon: MessageCircle, hint: 'Sends the PDF into the chat' },
  SMS: { label: 'SMS', icon: Smartphone, hint: 'A short text with the link' },
  EMAIL: { label: 'Email', icon: Mail, hint: 'The PDF is attached' },
};

/**
 * Automatic delivery. The server does the sending (WhatsApp Cloud API / SMS /
 * SMTP) and logs every attempt, so it works even if this tab is closed. Channels
 * the deployment has not configured are shown as unavailable rather than
 * silently failing.
 */
export function SendModal({ kind, id, reference, customer, businessName, defaultMessage, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [channels, setChannels] = useState(['WHATSAPP']);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    getMessagingStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        // Preselect the best available channel (prefer WhatsApp when live).
        const available = ['WHATSAPP', 'SMS', 'EMAIL'].filter((c) => s[c.toLowerCase()]);
        setChannels(available.length ? [available[0]] : ['EMAIL']);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const available = status ? Object.keys(CHANNEL_META).filter((c) => status[c.toLowerCase()]) : [];

  const toggle = (channel) =>
    setChannels((current) => (current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]));

  const submit = async (e) => {
    e.preventDefault();
    if (!channels.length) {
      toast.info('Choose at least one channel.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const data = await deliverDocument(kind, id, {
        channels,
        to: to.trim() || undefined,
        message: message.trim() || defaultMessage || undefined,
      });
      setResult(data);
      const sent = data.results.filter((r) => r.sent);
      if (sent.length) {
        toast.success(`Sent via ${sent.map((r) => CHANNEL_META[r.channel]?.label || r.channel).join(', ')}.`);
      } else {
        toast.info('Nothing was delivered — check that the channel is configured and the customer has contact details.', 'Not sent');
      }
    } catch (err) {
      toast.error(apiMessage(err, 'Could not send the document.'));
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = kind === 'QUOTATION' ? 'quotation' : kind === 'RECEIPT' ? 'receipt' : 'invoice';

  return (
    <Modal open title={`Send ${reference}`} onClose={onClose} description="Delivered automatically from the server — you can close this tab.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Channels" hint={available.length ? undefined : 'No delivery providers are configured yet — set WhatsApp/SMS/SMTP keys in the backend environment.'}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CHANNEL_META).map(([channel, meta]) => {
              const Icon = meta.icon;
              const enabled = !status || Boolean(status[channel.toLowerCase()]);
              const active = channels.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => enabled && toggle(channel)}
                  disabled={!enabled}
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                  title={enabled ? meta.hint : 'Not configured on the server'}
                >
                  <Icon size={15} /> {meta.label}
                  {!enabled && ' · off'}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Send to" hint={`Leave blank to use the customer's ${channels.includes('EMAIL') ? 'email' : 'phone number'} on file${customer?.phone ? ` (${customer.phone})` : ''}.`}>
          <input
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={customer?.phone || customer?.email || 'Phone number or email'}
          />
        </Field>

        <Field label="Message">
          <textarea
            rows={6}
            className="input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={defaultMessage || `Please find your ${kindLabel} ${reference} from ${businessName || 'us'}.`}
          />
        </Field>

        {result && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="mb-1 font-medium text-slate-700">Delivery result</p>
            <ul className="space-y-1">
              {result.results.map((r) => (
                <li key={r.channel} className="flex items-center gap-2">
                  <span className="font-medium">{CHANNEL_META[r.channel]?.label || r.channel}</span>
                  <span className={r.sent ? 'text-emerald-600' : 'text-amber-600'}>
                    {r.sent ? 'sent' : r.status === 'SKIPPED' ? `skipped${r.reason ? ` (${r.reason.replace(/_/g, ' ')})` : ''}` : 'failed'}
                  </span>
                  {r.error && <span className="text-slate-500">— {r.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !channels.length}>
            <Send size={15} /> {busy ? 'Sending…' : 'Send now'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Record payment modal (invoice detail) ────────────────────────── */

export function RecordPaymentModal({ invoice, onClose, onRecorded }) {
  const { activeTenant } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    amount: '',
    paymentDate: today,
    paymentMethod: 'BANK_TRANSFER',
    reference: '',
    notes: '',
  });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post(
        `/invoices/${invoice.id}/payments`,
        { ...form, amount: Number(form.amount) },
        { headers: { 'X-Tenant-Id': activeTenant.id } }
      );
      toast.success(`Payment recorded — receipt ${data.data.receipt.receiptNumber} generated.`);
      onRecorded?.(data.data);
      onClose();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not record the payment.'));
      setErrors(apiFieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Record payment · ${invoice.invoiceNumber}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Invoice total</span>
            <span className="font-medium">{formatMoney(invoice.total, settings)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Outstanding balance</span>
            <span className="font-semibold text-rose-600">{formatMoney(invoice.balanceDue, settings)}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Amount" required error={errors.amount}>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </Field>
          <Field label="Payment date" required error={errors.paymentDate}>
            <input
              type="date"
              className="input"
              value={form.paymentDate}
              onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
              required
            />
          </Field>
          <Field label="Method" required error={errors.paymentMethod}>
            <select
              className="input"
              value={form.paymentMethod}
              onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reference" error={errors.reference}>
            <input
              className="input"
              placeholder="Transfer ref, cheque no…"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Notes" error={errors.notes}>
          <textarea rows={2} className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Plus size={15} /> {busy ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Convert quotation → invoice confirmation ─────────────────────── */

export function ConvertToInvoiceModal({ quotation, onClose }) {
  const { activeTenant } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const convert = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(
        `/quotations/${quotation.id}/convert`,
        {},
        { headers: { 'X-Tenant-Id': activeTenant.id } }
      );
      toast.success(`Created ${data.data.invoice.invoiceNumber} from ${quotation.quotationNumber}.`);
      onClose(data.data.invoice);
    } catch (err) {
      toast.error(apiMessage(err, 'Could not convert the quotation.'));
      setBusy(false);
    }
  };

  return (
    <Modal open title="Convert to invoice" onClose={() => onClose(null)}>
      <div className="space-y-4">
        <div className="flex gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            This creates a new invoice from quotation <strong>{quotation.quotationNumber}</strong>, copying its
            customer, line items, tax and dates. The quotation becomes read-only (status <strong>Converted</strong>)
            and can no longer be edited or deleted.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={convert} disabled={busy}>
            <ArrowRightLeft size={15} /> {busy ? 'Converting…' : 'Create invoice'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
