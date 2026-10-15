import { runDueRecurringInvoices } from '../services/recurringService.js';
import { runDueReminders } from '../services/reminderService.js';

/**
 * Billing automation jobs — recurring invoice generation and dunning reminders.
 * Both are safe to run concurrently: recurring invoices lease rows with
 * FOR UPDATE SKIP LOCKED, and reminders dedupe on (ruleId, invoiceId).
 */

export default {
  'recurring.runDue': async () => {
    const report = await runDueRecurringInvoices();
    if (report.count) {
      console.log(`[job] recurring: generated ${report.count} invoice(s)`);
    } else {
      console.log('[job] recurring: nothing due');
    }
    if (report.failed.length) console.error('[job] recurring failures:', report.failed);
  },

  'reminders.runDue': async () => {
    const summary = await runDueReminders();
    if (summary.sent || summary.skipped || summary.failed) {
      console.log(
        `[job] reminders: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed across ${summary.rules} rule(s)`
      );
    } else {
      console.log(`[job] reminders: nothing due (${summary.rules} rule(s))`);
    }
  },
};

export const periodicTasks = [
  { type: 'recurring.runDue', everyMs: 15 * 60 * 1000, payload: {} },
  { type: 'reminders.runDue', everyMs: 6 * 60 * 60 * 1000, payload: {} },
];
