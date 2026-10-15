import { Router } from 'express';
import { validate } from '../middleware/errorHandler.js';
import { recurringInvoiceSchema, reminderRuleSchema } from '../validators/billingValidators.js';
import * as recurring from '../controllers/recurringController.js';
import * as reminders from '../controllers/reminderController.js';

/* ── Recurring invoices ───────────────────────────────────────────── */

export const recurringRouter = Router();
recurringRouter.get('/', recurring.listRecurring);
recurringRouter.post('/', validate(recurringInvoiceSchema), recurring.createRecurring);
recurringRouter.get('/:id', recurring.getRecurring);
recurringRouter.put('/:id', validate(recurringInvoiceSchema), recurring.updateRecurring);
recurringRouter.patch('/:id/status', recurring.setRecurringStatus);
recurringRouter.post('/:id/run', recurring.runRecurringNow);
recurringRouter.delete('/:id', recurring.deleteRecurring);

/* ── Payment reminder (dunning) rules ─────────────────────────────── */

export const reminderRouter = Router();
reminderRouter.get('/', reminders.listRules);
// Static paths must come before '/:id' so they are not captured as ids.
reminderRouter.get('/preview', reminders.preview);
reminderRouter.post('/run', reminders.runNow);
reminderRouter.post('/', validate(reminderRuleSchema), reminders.createRule);
reminderRouter.put('/:id', validate(reminderRuleSchema), reminders.updateRule);
reminderRouter.delete('/:id', reminders.deleteRule);
