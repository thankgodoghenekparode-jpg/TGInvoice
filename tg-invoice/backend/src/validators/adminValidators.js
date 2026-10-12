import { z } from 'zod';

/**
 * Platform-admin request validation. Only by-id/opaque values reach the
 * database; names, emails and roles are constrained here so the controller
 * can trust its input.
 */

const currency = z
  .object({
    code: z.string().trim().length(3).toUpperCase().catch('NGN'),
    symbol: z.string().trim().min(1).max(6).catch('₦'),
    position: z.enum(['prefix', 'suffix']).catch('prefix'),
  })
  .optional();

const optionalEmail = z.string().trim().email('Enter a valid email address.').optional().or(z.literal(''));

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'Business name must be at least 2 characters.').max(160),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: optionalEmail,
  country: z.string().trim().max(80).optional(),
  currency,
  ownerEmail: optionalEmail,
});

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2, 'Business name must be at least 2 characters.').max(160).optional(),
    phone: z.string().trim().max(40).optional().or(z.literal('')),
    email: optionalEmail,
    country: z.string().trim().max(80).optional(),
    accessExpiresAt: z.coerce.date().optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update.' });

// The platform owner manages a business's tenant admins (owner/admin) only —
// the tenant's staff are the tenant admin's concern, never the platform's.
export const grantMemberSchema = z
  .object({
    email: optionalEmail,
    userId: z.string().uuid('Invalid user id.').optional(),
    role: z.enum(['OWNER', 'ADMIN'], {
      errorMap: () => ({ message: 'Role must be OWNER or ADMIN.' }),
    }),
    accessExpiresAt: z.coerce.date().optional().nullable(),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.userId), {
    message: 'Provide a user email or id.',
    path: ['email'],
  });

export const setPlatformAdminSchema = z.object({
  isPlatformAdmin: z.boolean({ required_error: 'isPlatformAdmin is required.' }),
});

// Add (promote or create) a platform operator.
export const createPlatformUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(200)
    .optional()
    .or(z.literal('')),
});

export { setMemberExpirySchema } from './teamValidators.js';

export default {
  createTenantSchema,
  updateTenantSchema,
  grantMemberSchema,
  setPlatformAdminSchema,
  createPlatformUserSchema,
};
