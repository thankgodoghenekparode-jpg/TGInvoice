import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';
import { getSettings, previewUrlFor } from './documentService.js';
import { formatMoney, whatsappMessage } from '../utils/format.js';
import { deliver, messagingStatus } from './messagingService.js';

/**
 * Reusable document delivery shared by the manual "Send" action and the
 * background worker (recurring invoices, dunning reminders).
 *
 * WhatsApp gets the real PDF: our signed public share link serves the document
 * inline, and the Cloud API fetches that link and posts it into the chat.
 * SMS/email get the same message text (plus the link).
 */

export const KIND_META = {
  INVOICE: { model: 'invoice', number: 'invoiceNumber', label: 'Invoice', include: { customer: true, items: true } },
  QUOTATION: { model: 'quotation', number: 'quotationNumber', label: 'Quotation', include: { customer: true, items: true } },
  RECEIPT: { model: 'receipt', number: 'receiptNumber', label: 'Receipt', include: { customer: true, payment: true, invoice: true } },
};

const VALID_CHANNELS = ['EMAIL', 'WHATSAPP', 'SMS'];

/** Loads one tenant-scoped document, or throws the standard 404. */
export async function loadDocument(kind, id, tenantId) {
  const meta = KIND_META[kind];
  if (!meta) throw errors.badRequest('Unsupported document type.');
  const document = await prisma[meta.model].findFirst({
    where: { id, tenantId },
    include: meta.include,
  });
  if (!document) throw errors.notFound(`${meta.label} not found.`);
  return document;
}

export function buildDeliveryText({ kind, document, customer, settings }) {
  const meta = KIND_META[kind];
  return whatsappMessage({
    kind,
    customerName: customer?.name || 'there',
    businessName: settings.businessName || settings.name || 'our business',
    documentNumber: document[meta.number],
    amount: formatMoney(document.total ?? document.amount, settings),
    settings,
    previewUrl: previewUrlFor({ kind, document }),
  });
}

export const sanitizeChannels = (input) =>
  [...new Set((Array.isArray(input) ? input : []).map((c) => String(c).toUpperCase()).filter((c) => VALID_CHANNELS.includes(c)))];

/**
 * Deliver one document over the requested channels and return a per-channel
 * result. `to` overrides the customer's stored phone/email when provided.
 */
export async function deliverDocument({ kind, document, settings, channels, to, message, subject }) {
  const meta = KIND_META[kind];
  const customer = document.customer;
  const number = document[meta.number];
  const previewUrl = previewUrlFor({ kind, document });

  const text = message || buildDeliveryText({ kind, document, customer, settings });
  const mailSubject = subject || `${meta.label} ${number} from ${settings.businessName || 'your business'}`;

  const recipientFor = {
    WHATSAPP: to || customer?.phone,
    SMS: to || customer?.phone,
    EMAIL: to || customer?.email,
  };

  const results = [];
  for (const channel of channels) {
    const recipient = recipientFor[channel];
    if (!recipient) {
      results.push({ channel, sent: false, status: 'SKIPPED', reason: 'no_recipient' });
      continue;
    }
    // Sequential on purpose: providers rate-limit, and one failure should not
    // abort the remaining channels.
    const result = await deliver({
      tenantId: document.tenantId,
      channel,
      to: recipient,
      text,
      subject: mailSubject,
      documentLink: previewUrl,
      fileName: number,
      documentKind: kind,
      documentId: document.id,
      customerId: customer?.id,
    });
    results.push({ channel, ...result });
  }

  return { results, previewUrl, text };
}

/** Convenience: settings + document + send, for worker jobs. */
export async function deliverById({ kind, id, tenantId, channels, to, message, subject }) {
  const document = await loadDocument(kind, id, tenantId);
  const settings = await getSettings(tenantId);
  return { document, ...(await deliverDocument({ kind, document, settings, channels, to, message, subject })) };
}

/**
 * Auto-delivery used when a document is marked "sent": honours the tenant's
 * `autoSendChannels`, narrowed to the channels this deployment has configured.
 * Best-effort — returns null when nothing applies, and never throws.
 */
export async function autoDeliver(kind, documentId, tenantId) {
  const settings = await getSettings(tenantId);
  const requested = sanitizeChannels(settings.autoSendChannels);
  if (!requested.length) return null;

  const live = messagingStatus();
  const channels = requested.filter((c) => (c === 'WHATSAPP' ? live.whatsapp : c === 'SMS' ? live.sms : live.email));
  if (!channels.length) return null;

  try {
    const document = await loadDocument(kind, documentId, tenantId);
    const { results } = await deliverDocument({ kind, document, settings, channels });
    return results;
  } catch (err) {
    console.error(`[auto-deliver] ${kind} ${documentId}:`, err?.message);
    return null;
  }
}
