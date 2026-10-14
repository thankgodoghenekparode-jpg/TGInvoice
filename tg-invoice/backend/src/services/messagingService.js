import config from '../config.js';
import { prisma } from '../prisma.js';
import { isEmailConfigured, sendMail } from './emailService.js';

/**
 * Outbound messaging: WhatsApp Cloud API + SMS (+ email), with a delivery log.
 *
 * Every provider is env-gated and fails soft, mirroring the SMTP service:
 *  - unconfigured  → the send is recorded as SKIPPED and the caller gets
 *                    { sent: false, reason: 'not_configured' } — never a crash;
 *  - provider error → recorded as FAILED with the reason, and the caller gets
 *                    { sent: false, reason: 'failed' }.
 *
 * Every attempt (success or not) is written to MessageLog so a business can
 * prove what was delivered, to whom, and when — and re-send if needed.
 *
 * These functions are async/awaited from controllers, but reminders and
 * recurring invoices call them from the background worker.
 */

const PROVIDERS = {
  termii: 'termii',
  africas_talking: 'africas_talking',
  twilio: 'twilio',
};

/* ── Configuration checks ─────────────────────────────────────────── */

export const isWhatsAppConfigured = () => Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);

export function isSmsConfigured() {
  const { provider, apiKey, accountSid, authToken } = config.sms;
  if (provider === PROVIDERS.twilio) return Boolean(accountSid && authToken && config.sms.from);
  if (provider === PROVIDERS.termii || provider === PROVIDERS.africas_talking) return Boolean(apiKey);
  return false;
}

export const isChannelConfigured = (channel) => {
  if (channel === 'WHATSAPP') return isWhatsAppConfigured();
  if (channel === 'SMS') return isSmsConfigured();
  if (channel === 'EMAIL') return isEmailConfigured();
  return false;
};

export function messagingStatus() {
  return {
    email: isEmailConfigured(),
    whatsapp: isWhatsAppConfigured(),
    sms: isSmsConfigured(),
    smsProvider: config.sms.provider || null,
    whatsappBusinessNumber: config.whatsapp.businessNumber || null,
  };
}

/* ── Phone numbers ────────────────────────────────────────────────── */

/**
 * Normalise a phone number to E.164-like digits (no `+`).
 * A local number (`0803…`) is upgraded with the business's country code
 * (`234 → 803…`), which is the common case for Nigerian SMEs.
 */
export function normalizePhone(raw, { countryCode = config.whatsapp.countryCode || '234' } = {}) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  digits = digits.replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `${countryCode}${digits.slice(1)}`;
  if (!digits.startsWith(countryCode) && digits.length <= 10) digits = `${countryCode}${digits}`;
  return digits.length >= 8 ? digits : null;
}

/* ── WhatsApp Cloud API ───────────────────────────────────────────── */

async function graphPost(body) {
  const { apiVersion, phoneNumberId, token } = config.whatsapp;
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error?.message || `WhatsApp API error (${res.status})`;
    throw new Error(message);
  }
  return json?.messages?.[0]?.id || null;
}

/** Plain text message. */
export async function sendWhatsAppText({ to, text }) {
  const number = normalizePhone(to);
  if (!number) return { sent: false, reason: 'invalid_number' };
  if (!isWhatsAppConfigured()) return { sent: false, reason: 'not_configured' };
  try {
    const providerMessageId = await graphPost({ to: number, type: 'text', text: { preview_url: true, body: text } });
    return { sent: true, providerMessageId, to: number };
  } catch (err) {
    return { sent: false, reason: 'failed', error: err?.message };
  }
}

/**
 * Document message. WhatsApp fetches the file **from a public URL**, and our
 * signed public share link already serves the PDF inline — so we hand Meta the
 * link plus a filename and the customer receives the real PDF in the chat.
 */
export async function sendWhatsAppDocument({ to, link, filename, caption }) {
  const number = normalizePhone(to);
  if (!number) return { sent: false, reason: 'invalid_number' };
  if (!isWhatsAppConfigured()) return { sent: false, reason: 'not_configured' };
  if (!link) return sendWhatsAppText({ to, text: caption || '' });
  try {
    const providerMessageId = await graphPost({
      to: number,
      type: 'document',
      document: { link, filename: filename || 'document.pdf', caption: caption || undefined },
    });
    return { sent: true, providerMessageId, to: number };
  } catch (err) {
    // A bad/failed document fetch still deserves a fallback to the link text.
    const fallback = await sendWhatsAppText({ to: number, text: `${caption || 'Your document'}\n${link}` });
    return fallback.sent ? fallback : { sent: false, reason: 'failed', error: err?.message };
  }
}

/* ── SMS providers ────────────────────────────────────────────────── */

async function postForm(url, form, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* provider returned a non-JSON body */
  }
  if (!res.ok) throw new Error(json?.message || json?.SMSMessageData?.Message || text?.slice(0, 200) || `SMS error (${res.status})`);
  return json ?? text;
}

export async function sendSms({ to, text }) {
  const number = normalizePhone(to);
  if (!number) return { sent: false, reason: 'invalid_number' };
  if (!isSmsConfigured()) return { sent: false, reason: 'not_configured' };

  const { provider, apiKey, senderId, accountSid, authToken, from } = config.sms;
  try {
    if (provider === PROVIDERS.termii) {
      const json = await postForm('https://api.ng.termii.com/api/sms/send', {
        to: number,
        from: senderId || 'tgeasy',
        sms: text,
        type: 'plain',
        channel: 'generic',
        api_key: apiKey,
      });
      return { sent: true, provider, providerMessageId: json?.message_id || null, to: number };
    }

    if (provider === PROVIDERS.africas_talking) {
      const username = config.sms.username || senderId || 'sandbox';
      const json = await postForm(
        'https://api.africastalking.com/version1/messaging',
        { username, to: `+${number}`, message: text, from: senderId || undefined },
        { apiKey, Accept: 'application/json' }
      );
      return { sent: true, provider, providerMessageId: json?.SMSMessageData?.Recipients?.[0]?.messageId || null, to: number };
    }

    if (provider === PROVIDERS.twilio) {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const json = await postForm(
        url,
        { To: `+${number}`, From: from, Body: text },
        { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` }
      );
      return { sent: true, provider, providerMessageId: json?.sid || null, to: number };
    }

    return { sent: false, reason: 'not_configured' };
  } catch (err) {
    return { sent: false, reason: 'failed', error: err?.message };
  }
}

/* ── Delivery log ─────────────────────────────────────────────────── */

const clip = (value, max) => (value == null ? null : String(value).slice(0, max));

export async function logMessage(entry) {
  try {
    return await prisma.messageLog.create({
      data: {
        tenantId: entry.tenantId,
        channel: entry.channel,
        to: clip(entry.to, 64),
        subject: clip(entry.subject, 200),
        body: clip(entry.body, 4000),
        status: entry.status,
        provider: clip(entry.provider, 40),
        providerMessageId: clip(entry.providerMessageId, 200),
        error: clip(entry.error, 500),
        documentKind: entry.documentKind || null,
        documentId: entry.documentId || null,
        customerId: entry.customerId || null,
      },
    });
  } catch (err) {
    console.error('[messaging] could not write delivery log:', err?.message);
    return null;
  }
}

/* ── Unified send + log ───────────────────────────────────────────── */

/**
 * Send on one channel and record the attempt.
 * @param {{ tenantId: string, channel: 'WHATSAPP'|'SMS'|'EMAIL', to: string,
 *           text: string, subject?: string, html?: string, documentLink?: string,
 *           fileName?: string, documentKind?: string, documentId?: string,
 *           customerId?: string }} args
 */
export async function deliver(args) {
  const { tenantId, channel, to, text, subject, documentLink, fileName, documentKind, documentId, customerId } = args;

  let result;
  if (channel === 'WHATSAPP') {
    result = documentLink && fileName
      ? await sendWhatsAppDocument({ to, link: documentLink, filename: `${fileName}.pdf`, caption: text })
      : await sendWhatsAppText({ to, text });
  } else if (channel === 'SMS') {
    result = await sendSms({ to, text });
  } else if (channel === 'EMAIL') {
    if (!isEmailConfigured()) result = { sent: false, reason: 'not_configured' };
    else if (!to) result = { sent: false, reason: 'no_recipient' };
    else {
      const mail = await sendMail({ to, subject: subject || 'Notification', text });
      result = mail.sent ? { sent: true, provider: 'smtp' } : { sent: false, reason: mail.reason === 'not_configured' ? 'not_configured' : 'failed', error: mail.error };
    }
  } else {
    result = { sent: false, reason: 'unknown_channel' };
  }

  const status = result.sent
    ? 'SENT'
    : result.reason === 'not_configured'
      ? 'SKIPPED'
      : result.reason === 'invalid_number' || result.reason === 'no_recipient'
        ? 'SKIPPED'
        : 'FAILED';

  await logMessage({
    tenantId,
    channel,
    to: result.to || to,
    subject,
    body: text,
    status,
    provider: result.provider || (channel === 'WHATSAPP' ? 'whatsapp_cloud' : channel === 'SMS' ? config.sms.provider : 'smtp'),
    providerMessageId: result.providerMessageId,
    error: result.error || (result.reason && result.reason !== 'not_configured' ? result.reason : null),
    documentKind,
    documentId,
    customerId,
  });

  return { ...result, status };
}

export default {
  isWhatsAppConfigured,
  isSmsConfigured,
  isChannelConfigured,
  messagingStatus,
  normalizePhone,
  sendWhatsAppText,
  sendWhatsAppDocument,
  sendSms,
  logMessage,
  deliver,
};
