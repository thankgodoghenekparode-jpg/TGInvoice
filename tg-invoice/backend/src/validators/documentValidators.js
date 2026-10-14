import { z } from 'zod';



export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required.').max(160),
  companyName: z.string().trim().max(160).optional().or(z.literal('')),
  email: z.union([z.string().trim().email('Enter a valid email.'), z.literal('')]).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  country: z.string().trim().max(80).optional().or(z.literal('')),
  taxId: z.string().trim().max(60).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(160),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  category: z.string().trim().max(60).optional().or(z.literal('')).transform((v) => (v && v.length > 0 ? v : 'Other')),
  unit: z.string().trim().max(40).optional().or(z.literal('')),
  unitPrice: z.coerce.number().min(0, 'Price cannot be negative.').max(99_999_999_999),
  taxRate: z.coerce.number().min(0, 'Tax cannot be negative.').max(100),
  active: z.boolean().optional().default(true),
});

const money = z.coerce.number().min(0, 'Value cannot be negative.');
const rate = z.coerce.number().min(0).max(100);
const quantity = z.coerce.number().gt(0, 'Quantity must be greater than 0.');

const baseItem = z.object({
  productId: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1, 'Item description is required.').max(500),
  quantity,
  unitPrice: money,
  discountType: z.enum(['PERCENT', 'FIXED']).nullable().optional(),
  discountValue: z.coerce.number().min(0).optional().default(0),
  taxRate: rate.optional().default(0),
});

const documentBase = {
  customerId: z.string().uuid('Select a customer.'),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(3000).optional().or(z.literal('')),
  terms: z.string().trim().max(3000).optional().or(z.literal('')),
  items: z.array(baseItem).min(1, 'Add at least one item.').max(200),
};

export const quotationSchema = z.object({
  ...documentBase,
  quotationDate: z.coerce.date({ errorMap: () => ({ message: 'Enter a valid quotation date.' }) }),
  validUntil: z.coerce.date().nullable().optional(),
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']).optional().default('DRAFT'),
});

export const invoiceSchema = z.object({
  ...documentBase,
  invoiceDate: z.coerce.date({ errorMap: () => ({ message: 'Enter a valid invoice date.' }) }),
  dueDate: z.coerce.date().nullable().optional(),
  quotationId: z.string().uuid().nullable().optional(),
  status: z.enum(['DRAFT', 'SENT', 'UNPAID']).optional().default('UNPAID'),
});

export const paymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than 0.').max(99_999_999_999),
  paymentDate: z.coerce.date().optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'POS', 'CHEQUE', 'ONLINE', 'OTHER']).catch('BANK_TRANSFER'),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});
