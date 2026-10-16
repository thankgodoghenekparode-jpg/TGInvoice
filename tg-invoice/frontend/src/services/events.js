import { capture } from './analytics.js';

/**
 * Product analytics events.
 *
 * Event names live here so call sites and the PostHog dashboards can never
 * drift apart. Every helper is a silent no-op unless VITE_POSTHOG_KEY is set
 * (see ./analytics.js), so call sites never need a guard.
 *
 * The activation funnel we care about:
 *   signed_up → invoice_created → invoice_sent → payment_recorded
 */

export const EVENTS = {
  PAGEVIEW: '$pageview',
  SIGNED_UP: 'signed_up',
  QUOTATION_CREATED: 'quotation_created',
  INVOICE_CREATED: 'invoice_created',
  INVOICE_SENT: 'invoice_sent',
  PAYMENT_RECORDED: 'payment_recorded',
  PAYMENT_LINK_CREATED: 'payment_link_created',
  DOCUMENT_SHARED: 'document_shared',
  IMPORT_COMMITTED: 'import_committed',
  RECURRING_CREATED: 'recurring_created',
  REFERRAL_CODE_CREATED: 'referral_code_created',
};

/** Record a product event. Never throws; no-op without a configured key. */
export function track(event, props = {}) {
  capture(event, props);
}

export default { EVENTS, track };
