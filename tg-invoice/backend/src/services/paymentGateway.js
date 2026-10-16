import crypto from 'node:crypto';
import config from '../config.js';
import { errors } from '../utils/errors.js';

/**
 * Hosted-checkout transport for Paystack and Flutterwave.
 *
 * Everything network- and signature-related lives here; the database side
 * (PaymentIntent → Payment/Receipt) lives in `paymentService.js`. The whole
 * module degrades gracefully: with no keys configured every entry point says
 * so with a clear, actionable error instead of failing obscurely, so the app
 * runs locally without payment credentials.
 *
 * Env (see config.payments):
 *   PAYMENT_PROVIDER        paystack | flutterwave  (which one is active)
 *   PAYMENT_SECRET_KEY      generic secret (works for either provider)
 *   PAYSTACK_SECRET_KEY     / FLUTTERWAVE_SECRET_KEY — provider-specific overrides
 *   PAYMENT_WEBHOOK_SECRET  signature secret (defaults to the secret key)
 *   PAYMENT_CALLBACK_URL    where the browser lands after checkout
 */

const BASE = {
  paystack: 'https://api.paystack.co',
  flutterwave: 'https://api.flutterwave.com/v3',
};

/**
 * Currencies whose minor unit has no fractional digits. Everything else uses
 * 2 (Paystack prices in kobo, Flutterwave in plain units — the conversion is
 * provider-specific, see `createCheckout`).
 */
const ZERO_DECIMAL = new Set([
  'JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF', 'GNF', 'KMF', 'PYG',
  'XAF', 'XOF', 'XPF', 'VUV', 'KWD', 'BHD', 'OMR', 'TND',
]);

const minorUnitFactor = (currency) => (ZERO_DECIMAL.has(String(currency || '').toUpperCase()) ? 1 : 100);

export const PROVIDERS = ['paystack', 'flutterwave'];

/** Normalize a user/provider string ('Paystack', 'FLUTTERWAVE') → 'paystack'. */
export function normalizeProvider(provider) {
  const p = String(provider || config.payments.provider || '').trim().toLowerCase();
  if (!p) return null;
  if (!PROVIDERS.includes(p)) {
    throw errors.badRequest(`Unsupported payment provider "${p}". Use one of: ${PROVIDERS.join(', ')}.`);
  }
  return p;
}

const secretFor = (provider) =>
  provider === 'paystack'
    ? config.payments.paystackSecretKey || config.payments.secretKey || ''
    : config.payments.flutterwaveSecretKey || config.payments.secretKey || '';

const webhookSecretFor = (provider) => config.payments.webhookSecret || secretFor(provider);

/** Is this provider usable right now (provider chosen + secret present)? */
export function isConfigured(provider) {
  const p = normalizeProvider(provider || undefined);
  return Boolean(p && secretFor(p));
}

/** Configured provider of the deployment, or null when payments are off. */
export function activeProvider() {
  const p = String(config.payments.provider || '').trim().toLowerCase() || null;
  if (p && !PROVIDERS.includes(p)) return null; // typo'd env, treat as off
  return p && secretFor(p) ? p : null;
}

/** Thrown when checkout is requested but the deployment has no gateway. */
export function notConfiguredError() {
  return errors.badRequest(
    'Online payments are not enabled on this deployment. Set PAYMENT_PROVIDER (paystack | flutterwave) and PAYMENT_SECRET_KEY first.'
  );
}

function requireSecret(provider) {
  const secret = secretFor(provider);
  if (!secret) {
    throw errors.badRequest(
      `No secret key configured for ${provider}. Set ${provider === 'paystack' ? 'PAYSTACK_SECRET_KEY' : 'FLUTTERWAVE_SECRET_KEY'} (or PAYMENT_SECRET_KEY).`
    );
  }
  return secret;
}

/**
 * HTTP transport for gateway calls. Exported as an object so tests can swap
 * `transport.request` for a stub instead of hitting the network — production
 * only ever goes through `fetch`.
 */
export const transport = {
  async request({ url, method = 'GET', headers = {}, body }) {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body — handled below */
    }
    if (!res.ok) {
      const err = new Error(json?.message || json?.error || `Payment gateway responded with status ${res.status}.`);
      err.status = res.status;
      err.response = json;
      throw err;
    }
    return json ?? {};
  },
};

/**
 * Create a hosted checkout session for an invoice.
 * @returns {{ checkoutUrl: string, providerRef: string|null }}
 */
export async function createCheckout({
  provider,
  reference,
  amount,
  currency = 'NGN',
  email = '',
  name = '',
  description = '',
  callbackUrl = '',
  metadata = {},
}) {
  const p = normalizeProvider(provider);
  const secret = requireSecret(p);
  const value = Number(amount) || 0;

  if (p === 'paystack') {
    // Paystack takes the amount in the currency's minor unit (kobo for NGN).
    const body = await transport.request({
      url: `${BASE.paystack}/transaction/initialize`,
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: {
        email: email || undefined,
        amount: Math.round(value * minorUnitFactor(currency)),
        currency,
        reference,
        callback_url: callbackUrl || undefined,
        description: description || undefined,
        metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : undefined,
      },
    });
    if (!body?.status || !body?.data?.authorization_url) {
      throw new Error(body?.message || 'Paystack did not return a checkout URL.');
    }
    return {
      checkoutUrl: body.data.authorization_url,
      providerRef: body.data.access_code ? String(body.data.access_code) : null,
    };
  }

  // Flutterwave prices in plain currency units (no minor-unit conversion).
  const body = await transport.request({
    url: `${BASE.flutterwave}/transactions/initialize`,
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    body: {
      tx_ref: reference,
      amount: Math.round(value * 100) / 100,
      currency,
      customer: { email: email || undefined, name: name || undefined },
      redirect_url: callbackUrl || undefined,
      meta: Object.keys(metadata).length ? metadata : undefined,
      description: description || undefined,
    },
  });
  if (!body?.status || !body?.data?.link) {
    throw new Error(body?.message || 'Flutterwave did not return a checkout URL.');
  }
  return {
    checkoutUrl: body.data.link,
    providerRef: body.data.id ? String(body.data.id) : null,
  };
}

/**
 * Server-side verification (used by the client-side return path and by the
 * reconciliation job when a webhook was missed). Never trusts the browser.
 * @returns {{ ok, paidAt, amount, currency, providerRef, message }}
 */
export async function verify({ provider, reference }) {
  const p = normalizeProvider(provider);
  const secret = requireSecret(p);

  if (p === 'paystack') {
    const body = await transport.request({
      url: `${BASE.paystack}/transaction/verify/${encodeURIComponent(reference)}`,
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = body?.data || {};
    const paid = data.status === 'success';
    return {
      ok: paid,
      paidAt: paid && data.paid_at ? new Date(data.paid_at) : null,
      amount: (Number(data.amount) || 0) / minorUnitFactor(data.currency || 'NGN'),
      currency: data.currency || 'NGN',
      providerRef: data.transaction_id != null ? String(data.transaction_id) : null,
      message: data.message || body?.message || '',
    };
  }

  const body = await transport.request({
    url: `${BASE.flutterwave}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = body?.data || {};
  const paid = data.status === 'successful';
  return {
    ok: paid,
    paidAt: paid && data.created_at ? new Date(data.created_at) : null,
    amount: Number(data.amount) || 0,
    currency: data.currency || 'NGN',
    providerRef: data.id != null ? String(data.id) : null,
    message: data.processor_response || body?.message || '',
  };
}

/**
 * HMAC check over the raw request body — the only thing that authenticates a
 * webhook. `rawBody` is captured by express' JSON `verify` hook (see app.js);
 * parsing happens after the signature is proven.
 */
export function verifySignature({ provider, rawBody, signature }) {
  let p;
  try {
    p = normalizeProvider(provider);
  } catch {
    return false;
  }
  if (!p || !rawBody || !signature) return false;
  const secret = webhookSecretFor(p);
  if (!secret) return false;

  const expected = crypto
    .createHmac(p === 'paystack' ? 'sha512' : 'sha256', secret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Normalize a provider webhook payload into one shape:
 * `{ reference, paid, failed, amount, currency, paidAt, providerRef }`.
 * Returns null when the payload carries no reference we can act on.
 */
export function parseWebhook({ provider, payload }) {
  const p = normalizeProvider(provider);
  if (!payload || typeof payload !== 'object') return null;

  if (p === 'paystack') {
    const data = payload.data || {};
    if (!data.reference) return null;
    const event = String(payload.event || '');
    return {
      event,
      reference: String(data.reference),
      paid: event === 'charge.success',
      // refund/dispute events mean money went the other way — the caller
      // marks the intent FAILED rather than settling it.
      failed: event.startsWith('charge.') && event !== 'charge.success' && event !== 'charge.pending',
      amount: (Number(data.amount) || 0) / minorUnitFactor(data.currency || 'NGN'),
      currency: data.currency || 'NGN',
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      providerRef: data.transaction_id != null ? String(data.transaction_id) : null,
    };
  }

  const data = payload.data || {};
  const reference = data.tx_ref || payload.tx_ref;
  if (!reference) return null;
  const status = String(data.status || '');
  const event = String(payload.event || '');
  return {
    event,
    reference: String(reference),
    paid: (event === 'charge.completed' || !event) && status === 'successful',
    failed: Boolean(status && status !== 'successful' && status !== 'pending'),
    amount: Number(data.amount) || 0,
    currency: data.currency || 'NGN',
    paidAt: data.created_at ? new Date(data.created_at) : null,
    providerRef: data.id != null ? String(data.id) : null,
  };
}

export default {
  PROVIDERS,
  normalizeProvider,
  isConfigured,
  activeProvider,
  notConfiguredError,
  createCheckout,
  verify,
  verifySignature,
  parseWebhook,
  transport,
};
