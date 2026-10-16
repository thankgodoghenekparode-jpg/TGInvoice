import { reconcileStaleIntents } from '../services/paymentService.js';

/**
 * Payment jobs — webhook reconciliation.
 *
 * Gateways retry webhooks, but retries can exhaust before our endpoint is
 * reachable (deploy, restart, outage). Anything still PENDING an hour after
 * the customer opened checkout is verified straight against the gateway API
 * and settled if it really was paid — so a missed webhook costs a delay, not
 * a payment. No gateway configured → the job is a no-op.
 */

export default {
  'payments.reconcile': async () => {
    const report = await reconcileStaleIntents();
    if (report.scanned) {
      console.log(
        `[job] payments: confirmed ${report.settled} of ${report.scanned} stale checkout(s)` +
          (report.unknown ? `, ${report.unknown} unknown` : '')
      );
    }
  },
};

export const periodicTasks = [{ type: 'payments.reconcile', everyMs: 60 * 60 * 1000, payload: {} }];
