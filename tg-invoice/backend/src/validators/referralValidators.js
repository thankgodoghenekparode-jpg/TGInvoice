import { z } from 'zod';

/**
 * Referral + partner validation. Values arrive as JSON, so numbers/booleans
 * are already typed; `z.coerce` keeps form-encoded clients working too.
 */

const codeString = z
  .string()
  .trim()
  .max(16, 'Referral codes are at most 16 characters.')
  .optional()
  .or(z.literal(''));

const rewardType = z.enum(['PERCENT', 'FIXED'], { errorMap: () => ({ message: 'Choose a percentage or a fixed reward.' }) });

const rewardValue = z.coerce
  .number({ invalid_type_error: 'Enter a reward amount.' })
  .min(0, 'The reward cannot be negative.')
  .max(1_000_000);

const maxUses = z.coerce.number().int('Use a whole number.').min(1, 'At least 1 use.').max(1_000_000).optional().nullable();

export const createReferralCodeSchema = z.object({
  code: codeString,
  rewardType: rewardType.default('PERCENT'),
  rewardValue: rewardValue.default(0),
  maxUses,
});

export const updateReferralCodeSchema = z.object({
  active: z.boolean().optional(),
  rewardType: rewardType.optional(),
  rewardValue: rewardValue.optional(),
  maxUses,
});

export const rewardReferralSchema = z.object({
  baseAmount: z.coerce.number().min(0).max(1_000_000_000_000).optional().nullable(),
});

export const createPartnerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the partner name.').max(160),
  type: z.enum(['RESELLER', 'ACCOUNTANT', 'AFFILIATE']).default('AFFILIATE'),
  email: z.union([z.string().trim().email('Enter a valid email address.'), z.literal('')]).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  companyName: z.string().trim().max(160).optional().or(z.literal('')),
  commissionRate: z.coerce.number().min(0, 'Between 0 and 100.').max(100, 'Between 0 and 100.').default(0),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const updatePartnerSchema = createPartnerSchema.partial().extend({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export const createPartnerCodeSchema = createReferralCodeSchema;
