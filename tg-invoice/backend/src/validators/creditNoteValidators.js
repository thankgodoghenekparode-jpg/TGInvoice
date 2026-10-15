import { z } from 'zod';
import { lineItemSchema } from './documentValidators.js';

/** Credit notes, credit-note application, and refunds. */

export const creditNoteSchema = z.object({
  customerId: z.string().uuid('Select a customer.'),
  invoiceId: z.string().uuid().nullable().optional(),
  creditNoteDate: z.coerce.date({ errorMap: () => ({ message: 'Enter a valid credit note date.' }) }).optional(),
  reason: z.string().trim().max(300).optional().or(z.literal('')),
  notes: z.string().trim().max(3000).optional().or(z.literal('')),
  items: z.array(lineItemSchema).min(1, 'Add at least one item.').max(200),
  saveCustomItems: z.boolean().optional().default(true),
});

export const applyCreditSchema = z.object({
  invoiceId: z.string().uuid('Select an invoice.').optional(),
  amount: z.coerce.number().positive('Enter an amount greater than 0.').max(99_999_999_999).optional(),
});

/** A refund is cash paid back to a customer. */
export const refundSchema = z.object({
  customerId: z.string().uuid('Select a customer.'),
  amount: z.coerce.number().positive('Refund amount must be greater than 0.').max(99_999_999_999),
  refundDate: z.coerce.date().optional(),
  method: z
    .enum(['CASH', 'BANK_TRANSFER', 'POS', 'CHEQUE', 'ONLINE', 'OTHER'])
    .catch('BANK_TRANSFER'),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  reason: z.string().trim().max(300).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  invoiceId: z.string().uuid().nullable().optional(),
  creditNoteId: z.string().uuid().nullable().optional(),
  paymentId: z.string().uuid().nullable().optional(),
});
