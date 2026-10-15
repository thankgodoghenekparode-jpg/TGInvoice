import { z } from 'zod';
import { lineItemSchema } from './documentValidators.js';

/** Recurring invoice templates + dunning rules. */

export const recurringInvoiceSchema = z.object({
  customerId: z.string().uuid('Select a customer.'),
  name: z.string().trim().min(1, 'Give this schedule a name.').max(160),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL']).default('MONTHLY'),
  interval: z.coerce.number().int().min(1, 'Repeat at least every 1').max(60).default(1),
  nextRunAt: z.coerce.date({ errorMap: () => ({ message: 'Enter a valid start date.' }) }).optional(),
  endDate: z.coerce.date().nullable().optional(),
  dueInDays: z.coerce.number().int().min(0, 'Cannot be negative.').max(365).default(14),
  autoSend: z.boolean().optional().default(true),
  autoCharge: z.boolean().optional().default(false),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional().default('ACTIVE'),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(3000).optional().or(z.literal('')),
  terms: z.string().trim().max(3000).optional().or(z.literal('')),
  items: z.array(lineItemSchema).min(1, 'Add at least one item.').max(200),
  saveCustomItems: z.boolean().optional().default(true),
});

export const reminderRuleSchema = z.object({
  name: z.string().trim().min(1, 'Give this reminder a name.').max(160),
  enabled: z.boolean().optional().default(true),
  stage: z.enum(['BEFORE_DUE', 'ON_DUE', 'AFTER_DUE']).default('AFTER_DUE'),
  offsetDays: z.coerce.number().int().min(-365).max(365).default(0),
  channels: z.array(z.enum(['EMAIL', 'WHATSAPP', 'SMS'])).min(1, 'Choose at least one channel.').default(['EMAIL']),
  subject: z.string().trim().max(200).optional().or(z.literal('')),
  bodyTemplate: z.string().trim().max(4000).optional().or(z.literal('')),
});
