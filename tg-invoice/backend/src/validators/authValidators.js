import { z } from 'zod';

const email = z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be 72 characters or fewer.')
  .regex(/[A-Za-z]/, 'Password must include a letter.')
  .regex(/[0-9]/, 'Password must include a number.');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(120),
  email,
  password,
  confirmPassword: z.string().optional(),
  business: z.object({
    name: z.string().trim().min(2, 'Business name is required.').max(160),
    phone: z.string().trim().max(40).optional().or(z.literal('')),
    email: z.union([email, z.literal('')]).optional(),
    country: z.string().trim().max(80).optional(),
    currency: z
      .object({
        code: z.string().trim().length(3).toUpperCase().catch('NGN'),
        symbol: z.string().trim().min(1).max(6).catch('₦'),
        position: z.enum(['prefix', 'suffix']).catch('prefix'),
      })
      .optional(),
  }),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Invalid reset link.'),
  password,
  confirmPassword: z.string().optional(),
});

export const verifyEmailSchema = z.object({ token: z.string().min(10) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: password,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(120),
  email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.'),
});
