import api from './api.js';

/**
 * Online payments — hosted checkout links (Paystack / Flutterwave).
 *
 * Creating a link returns a checkout URL you can send to the customer (or read
 * out over the phone). The gateway webhook settles the invoice; `verify` lets
 * the UI confirm on demand without waiting for it.
 */

export const listPaymentLinks = (invoiceId) =>
  api.get(`/invoices/${invoiceId}/payment-links`).then((r) => r.data.data);

/** `{ amount? }` — omit the amount to charge the full outstanding balance. */
export const createPaymentLink = (invoiceId, body = {}) =>
  api.post(`/invoices/${invoiceId}/payment-link`, body).then((r) => r.data.data);

/** Ask the server to confirm with the gateway (returns `{ intent, verification }`). */
export const verifyPaymentLink = (invoiceId, intentId) =>
  api
    .post(`/invoices/${invoiceId}/payment-links/${intentId}/verify`)
    .then((r) => ({ intent: r.data.data, verification: r.data.meta?.verification ?? null }));

export const cancelPaymentLink = (invoiceId, intentId) =>
  api.post(`/invoices/${invoiceId}/payment-links/${intentId}/cancel`).then((r) => r.data.data);

export default { listPaymentLinks, createPaymentLink, verifyPaymentLink, cancelPaymentLink };
