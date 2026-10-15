import { z } from 'zod';
import { CUSTOM_FIELD_ENTITIES, FIELD_TYPES } from '../services/customFieldService.js';

/** Custom-field definitions + per-record values. */

const entity = z.enum(CUSTOM_FIELD_ENTITIES, {
  errorMap: () => ({ message: 'Choose a valid record type.' }),
});

const key = z
  .string()
  .trim()
  .min(1, 'Enter a field key.')
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/i, 'Use letters, numbers and underscores only.');

const baseField = z.object({
  entity,
  label: z.string().trim().min(1, 'Give the field a label.').max(80),
  key: key.optional(),
  type: z.enum(FIELD_TYPES).default('TEXT'),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional().default(false),
  showOnDocument: z.boolean().optional().default(false),
  position: z.coerce.number().int().min(0).max(999).optional().default(0),
});

const requireSelectOptions = (val, ctx) => {
  if (val.type === 'SELECT' && (!val.options || val.options.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Add at least one option.' });
  }
};

export const customFieldSchema = baseField.superRefine(requireSelectOptions);

/** PATCH: every property optional — the controller merges with the stored field. */
export const customFieldUpdateSchema = baseField.partial();

const rawValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

export const customFieldValuesSchema = z.object({
  entity,
  entityId: z.string().uuid('Choose the record these values belong to.'),
  values: z.record(z.string(), rawValue).default({}),
});

export const documentTemplateSchema = z.object({
  name: z.string().trim().max(120).optional().or(z.literal('')),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #2563eb.')
    .nullable()
    .optional()
    .or(z.literal('')),
  showLogo: z.boolean().optional(),
  showBankDetails: z.boolean().optional(),
  headerNote: z.string().trim().max(500).nullable().optional().or(z.literal('')),
  footerNote: z.string().trim().max(500).nullable().optional().or(z.literal('')),
});
