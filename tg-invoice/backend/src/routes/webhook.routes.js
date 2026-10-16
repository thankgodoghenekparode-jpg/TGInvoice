import { Router } from 'express';
import { asyncHandler } from '../utils/errors.js';
import * as gateway from '../services/paymentGateway.js';
import { settlePaymentIntent, failPaymentIntent } from '../services/paymentService.js';

/**
 * Gateway webhooks — the source of truth for "this invoice was paid".
 *
 * Signature first, parse second: the raw body is captured by express' JSON
 * `verify` hook (see app.js) and checked with the provider HMAC before any
 * payload is trusted. No auth/tenant headers exist here — the HMAC *is* the
 * credential, so the endpoints are public and must stay side-effect-free for
 * anything that fails verification.
 *
 * Every authentic delivery answers 2xx (unknown references included) so
 * providers stop retrying; genuine failures answer 5xx so they do retry.
 */

const SIGNATURE_HEADER = { paystack: 'x-paystack-signature', flutterwave: 'verif-hash' };

const summarize = (out) => {
  if (out.unknown) return { status: 'unknown_reference' };
  if (out.settled) return { status: 'settled' };
  if (out.already) return { status: 'already_settled' };
  if (out.mismatch) return { status: 'amount_mismatch' };
  if (out.rejected) return { status: 'invoice_closed' };
  if (out.overpaid) return { status: 'already_paid_invoice' };
  if (out.closed) return { status: 'intent_closed' };
  if (out.failed) return { status: 'failed' };
  return { status: 'ok' };
};

function webhookHandler(provider) {
  return asyncHandler(async (req, res) => {
    const signature = req.get(SIGNATURE_HEADER[provider]);
    if (!gateway.verifySignature({ provider, rawBody: req.rawBody, signature })) {
      console.warn(`[webhooks] rejected ${provider} delivery (bad signature)`);
      return res.status(401).json({ success: false, message: 'Invalid signature.' });
    }

    const event = gateway.parseWebhook({ provider, payload: req.body });
    if (!event?.reference) {
      return res.json({ success: true, ...summarize({ unknown: true }) });
    }

    if (event.paid) {
      const out = await settlePaymentIntent({ reference: event.reference, provider, event });
      if (out.unknown) console.warn(`[webhooks] ${provider} settled nothing — no intent for ${event.reference}`);
      return res.json({ success: true, ...summarize(out) });
    }

    if (event.failed) {
      await failPaymentIntent({
        reference: event.reference,
        reason: `${provider} reported a failed charge (${event.event || event.amount || 'no detail'}).`,
      });
      return res.json({ success: true, ...summarize({ failed: true }) });
    }

    // Authentic but not final (pending/processing events) — acknowledge.
    return res.json({ success: true, status: 'pending' });
  });
}

const router = Router();

router.post('/paystack', webhookHandler('paystack'));
router.post('/flutterwave', webhookHandler('flutterwave'));

/** GET — lets an operator confirm the endpoint is live without firing events. */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    providers: {
      paystack: { configured: gateway.isConfigured('paystack'), path: '/api/webhooks/paystack' },
      flutterwave: { configured: gateway.isConfigured('flutterwave'), path: '/api/webhooks/flutterwave' },
    },
  });
});

export default router;
