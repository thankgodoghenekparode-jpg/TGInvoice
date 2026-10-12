/**
 * Development / demo seed data.
 *
 *   npx prisma db seed          (or: node prisma/seed.js)
 *   node prisma/seed.js --reset  (wipe seeded tenants first, then re-seed)
 *
 * DEMO CREDENTIALS — development only, NEVER use in production:
 *   Zarox Energy Company  →  admin@zarox-energy.com  /  ChangeMe123!
 *   ABC Engineering Ltd   →  admin@abc-engineering.com / ChangeMe123!
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { calculateDocumentTotals, deriveInvoiceStatus, computeBalance } from '../src/utils/money.js';
import { allocateDocumentNumber } from '../src/services/sequenceService.js';
import { logAudit } from '../src/services/auditService.js';

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const daysAhead = (n) => new Date(Date.now() + n * DAY);

async function main() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    console.log('Resetting seeded tenants…');
    await prisma.tenant.deleteMany({ where: { slug: { in: ['zarox-energy', 'abc-engineering'] } } });
    // The seeded owners are global users, so deleting the tenants alone would
    // leave them behind and trip the "already seeded" guard below.
    await prisma.user.deleteMany({
      where: { email: { in: ['admin@zarox-energy.com', 'admin@abc-engineering.com'] } },
    });
  }

  const existing = await prisma.user.findUnique({ where: { email: 'admin@zarox-energy.com' } });
  if (existing) {
    console.log('Already seeded. Use "node prisma/seed.js --reset" to re-seed.');
    return;
  }

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);

  /* ════════════════════════════════════════════════════════════════
     TENANT 1 — Zarox Energy Company (the demo business)
     ════════════════════════════════════════════════════════════════ */

  const zarox = await prisma.tenant.create({ data: { name: 'Zarox Energy Company', slug: 'zarox-energy' } });
  const zaroxOwner = await prisma.user.create({
    data: { name: 'Amaka Obi', email: 'admin@zarox-energy.com', passwordHash, emailVerified: true },
  });
  await prisma.membership.create({
    data: { userId: zaroxOwner.id, tenantId: zarox.id, role: 'OWNER', status: 'ACTIVE' },
  });

  await prisma.companySettings.create({
    data: {
      tenantId: zarox.id,
      businessName: 'Zarox Energy Company',
      address: '12 Adeola Odeku Street, Victoria Island, Lagos',
      phone: '+234 801 234 5678',
      email: 'billing@zarox-energy.com',
      website: 'https://zaroxenergy.com',
      taxId: '12345678-0001',
      country: 'Nigeria',
      currency: 'NGN',
      currencySymbol: '₦',
      currencyPosition: 'prefix',
      defaultCurrency: 'NGN',
      bankName: 'Zenith Bank',
      accountName: 'Zarox Energy Company',
      accountNumber: '1012345678',
      paymentInstructions: 'Payment is due within 14 days. Please use your invoice or quotation number as the payment reference.',
      invoicePrefix: 'INV',
      quotationPrefix: 'QT',
      receiptPrefix: 'REC',
      defaultTaxRate: 7.5,
      defaultInvoiceNotes: 'Thank you for choosing Zarox Energy Company for your energy solutions.',
      defaultQuotationTerms: 'This quotation is valid for 30 days from the date of issue. Prices are inclusive of applicable taxes unless stated otherwise.',
      defaultReceiptNotes: 'This receipt confirms payment received. Please retain it for your records.',
      onboardingComplete: true,
    },
  });

  for (const kind of ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT']) {
    await prisma.documentSequence.create({
      data: { tenantId: zarox.id, kind, prefix: kind === 'CUSTOMER' ? 'CUS' : kind === 'QUOTATION' ? 'QT' : kind === 'RECEIPT' ? 'REC' : 'INV', next: 1 },
    });
  }

  /* Customers (tenant-specific codes CUS-00001…) */
  const customerData = [
    {
      customerCode: 'CUS-00001',
      name: 'Chidi Okafor',
      companyName: 'ABC Engineering Ltd',
      email: 'chidi@abc-engineering.ng',
      phone: '+234 803 555 0192',
      address: '15 Industrial Way, Oregun',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'Nigeria',
      notes: 'Preferred client — repeat business.',
    },
    {
      customerCode: 'CUS-00002',
      name: 'Aisha Bello',
      companyName: 'Lagos Water Corporation',
      email: 'a.bello@lagoswater.gov.ng',
      phone: '+234 802 777 3344',
      address: 'Power House Road, Alausa',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'Nigeria',
      taxId: '98765432-0001',
    },
    {
      customerCode: 'CUS-00003',
      name: 'Tunde Adeyemi',
      companyName: 'Bright Homes Ltd',
      email: 'tunde@brighthomes.ng',
      phone: '+234 701 990 8877',
      address: '7 Aminu Kano Crescent, Wuse II',
      city: 'Abuja',
      state: 'FCT',
      country: 'Nigeria',
    },
  ];
  const customers = [];
  for (const c of customerData) {
    customers.push(await prisma.customer.create({ data: { tenantId: zarox.id, isDemo: true, ...c } }));
  }

  /* Products & services */
  const productData = [
    { name: 'Meter Installation', description: 'Supply and installation of single/three-phase energy meters.', category: 'METER_INSTALLATION', unit: 'job', unitPrice: 100000, taxRate: 7.5 },
    { name: 'Meter Relocation', description: 'Safe disconnection and relocation of existing meters.', category: 'METER_RELOCATION', unit: 'job', unitPrice: 150000, taxRate: 7.5 },
    { name: 'Energy Service', description: 'End-to-end energy audit and supply service.', category: 'ENERGY_SERVICE', unit: 'project', unitPrice: 250000, taxRate: 7.5 },
    { name: 'Technical Service', description: 'On-site technical support and maintenance.', category: 'TECHNICAL_SERVICE', unit: 'day', unitPrice: 75000, taxRate: 7.5 },
    { name: 'Consultation', description: 'Professional energy consultation session.', category: 'CONSULTATION', unit: 'session', unitPrice: 50000, taxRate: 0 },
  ];
  const products = [];
  for (const p of productData) {
    products.push(await prisma.product.create({ data: { tenantId: zarox.id, isDemo: true, ...p } }));
  }

  const zs = { quotationPrefix: 'QT', invoicePrefix: 'INV', receiptPrefix: 'REC' };

  /* Quotation QT-00001 (→ converted to INV-00001) */
  const q1Items = calculateDocumentTotals([
    { productId: products[0].id, description: 'Meter Installation', quantity: 2, unitPrice: 100000, discountType: null, discountValue: 0, taxRate: 7.5 },
  ]);
  const q1Number = await allocateDocumentNumber(prisma, zarox.id, 'QUOTATION', zs);
  const quotation1 = await prisma.quotation.create({
    data: {
      tenantId: zarox.id,
      customerId: customers[0].id,
      isDemo: true,
      quotationNumber: q1Number,
      quotationDate: daysAgo(24),
      validUntil: daysAhead(6),
      reference: 'RFQ-2026-014',
      status: 'SENT',
      subtotal: q1Items.subtotal,
      discountAmount: q1Items.discountAmount,
      taxAmount: q1Items.taxAmount,
      total: q1Items.total,
      notes: 'Installation to be completed within 5 working days of confirmation.',
      terms: 'This quotation is valid for 30 days from the date of issue.',
      createdById: zaroxOwner.id,
      items: { create: itemRows(q1Items.items) },
    },
  });

  /* Quotation QT-00002 (accepted) */
  const q2Items = calculateDocumentTotals([
    { productId: products[1].id, description: 'Meter Relocation', quantity: 1, unitPrice: 150000, discountType: null, discountValue: 0, taxRate: 7.5 },
    { productId: products[4].id, description: 'Consultation — site assessment', quantity: 2, unitPrice: 50000, discountType: null, discountValue: 0, taxRate: 0 },
  ]);
  const q2Number = await allocateDocumentNumber(prisma, zarox.id, 'QUOTATION', zs);
  const quotation2 = await prisma.quotation.create({
    data: {
      tenantId: zarox.id,
      customerId: customers[1].id,
      isDemo: true,
      quotationNumber: q2Number,
      quotationDate: daysAgo(10),
      validUntil: daysAhead(20),
      status: 'ACCEPTED',
      subtotal: q2Items.subtotal,
      discountAmount: q2Items.discountAmount,
      taxAmount: q2Items.taxAmount,
      total: q2Items.total,
      notes: 'Relocation to be carried out during off-peak hours.',
      createdById: zaroxOwner.id,
      items: { create: itemRows(q2Items.items) },
    },
  });

  /* Invoice INV-00001 — converted from QT-00001, partially paid */
  const i1Number = await allocateDocumentNumber(prisma, zarox.id, 'INVOICE', zs);
  const invoice1 = await prisma.invoice.create({
    data: {
      tenantId: zarox.id,
      customerId: customers[0].id,
      quotationId: quotation1.id,
      isDemo: true,
      invoiceNumber: i1Number,
      invoiceDate: daysAgo(20),
      dueDate: daysAhead(10),
      reference: 'RFQ-2026-014',
      status: 'UNPAID',
      subtotal: q1Items.subtotal,
      discountAmount: q1Items.discountAmount,
      taxAmount: q1Items.taxAmount,
      total: q1Items.total,
      amountPaid: 0,
      balanceDue: q1Items.total,
      notes: 'Thank you for choosing Zarox Energy Company for your energy solutions.',
      createdById: zaroxOwner.id,
      items: { create: itemRows(q1Items.items) },
    },
  });
  await prisma.quotation.update({ where: { id: quotation1.id }, data: { status: 'CONVERTED' } });

  /* Invoice INV-00002 — fully paid */
  const i2Items = calculateDocumentTotals([
    { productId: products[2].id, description: 'Energy Service — Q2 supply contract', quantity: 1, unitPrice: 250000, discountType: null, discountValue: 0, taxRate: 7.5 },
  ]);
  const i2Number = await allocateDocumentNumber(prisma, zarox.id, 'INVOICE', zs);
  const invoice2 = await prisma.invoice.create({
    data: {
      tenantId: zarox.id,
      customerId: customers[2].id,
      isDemo: true,
      invoiceNumber: i2Number,
      invoiceDate: daysAgo(45),
      dueDate: daysAgo(15),
      status: 'UNPAID',
      subtotal: i2Items.subtotal,
      discountAmount: i2Items.discountAmount,
      taxAmount: i2Items.taxAmount,
      total: i2Items.total,
      amountPaid: 0,
      balanceDue: i2Items.total,
      createdById: zaroxOwner.id,
      items: { create: itemRows(i2Items.items) },
    },
  });

  /* Payments → Receipts (same flow the API uses) */
  await seedPayment(zarox.id, zaroxOwner.id, invoice1, 100000, daysAgo(15), 'BANK_TRANSFER', 'ZENITH/TRF/889210', 'Part payment — balance due.');
  await seedPayment(zarox.id, zaroxOwner.id, invoice2, Number(invoice2.total), daysAgo(40), 'POS', 'POS/009921', 'Payment in full.');

  await logAudit({ tenantId: zarox.id, userId: zaroxOwner.id }, 'CREATE_QUOTATION', 'quotation', { entityLabel: quotation1.quotationNumber, description: `Amaka Obi created quotation ${quotation1.quotationNumber}` });
  await logAudit({ tenantId: zarox.id, userId: zaroxOwner.id }, 'CONVERT_QUOTATION', 'quotation', { entityLabel: quotation1.quotationNumber, description: `Amaka Obi converted ${quotation1.quotationNumber} to ${invoice1.invoiceNumber}` });
  await logAudit({ tenantId: zarox.id, userId: zaroxOwner.id }, 'CREATE_INVOICE', 'invoice', { entityLabel: invoice1.invoiceNumber, description: `Amaka Obi created invoice ${invoice1.invoiceNumber}` });
  await logAudit({ tenantId: zarox.id, userId: zaroxOwner.id }, 'RECORD_PAYMENT', 'payment', { entityLabel: invoice1.invoiceNumber, description: `Amaka Obi recorded payment of ₦100,000.00 on ${invoice1.invoiceNumber}` });

  /* ════════════════════════════════════════════════════════════════
     TENANT 2 — ABC Engineering Ltd (proves tenant isolation)
     Completely separate data, independent numbering (also INV-00001).
     ════════════════════════════════════════════════════════════════ */

  const abc = await prisma.tenant.create({ data: { name: 'ABC Engineering Ltd', slug: 'abc-engineering' } });
  const abcOwner = await prisma.user.create({
    data: { name: 'John Mensah', email: 'admin@abc-engineering.com', passwordHash, emailVerified: true },
  });
  await prisma.membership.create({ data: { userId: abcOwner.id, tenantId: abc.id, role: 'OWNER', status: 'ACTIVE' } });

  await prisma.companySettings.create({
    data: {
      tenantId: abc.id,
      businessName: 'ABC Engineering Ltd',
      address: '3 Adeyemi Akapo Street, Ogba',
      phone: '+234 805 444 1212',
      email: 'accounts@abc-engineering.ng',
      country: 'Nigeria',
      currency: 'NGN',
      currencySymbol: '₦',
      defaultCurrency: 'NGN',
      bankName: 'Access Bank',
      accountName: 'ABC Engineering Ltd',
      accountNumber: '0771122334',
      invoicePrefix: 'INV',
      quotationPrefix: 'QT',
      receiptPrefix: 'REC',
      defaultTaxRate: 7.5,
      onboardingComplete: true,
    },
  });
  for (const kind of ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT']) {
    await prisma.documentSequence.create({
      data: { tenantId: abc.id, kind, prefix: kind === 'CUSTOMER' ? 'CUS' : kind === 'QUOTATION' ? 'QT' : kind === 'RECEIPT' ? 'REC' : 'INV', next: 1 },
    });
  }

  const johnConstruction = await prisma.customer.create({
    data: {
      tenantId: abc.id,
      isDemo: true,
      customerCode: 'CUS-00001',
      name: 'Peter John',
      companyName: 'John Construction',
      email: 'peter@johnconstruction.ng',
      phone: '+234 806 121 0909',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
    },
  });

  const abcInvoiceItems = calculateDocumentTotals([
    { description: 'Structural survey', quantity: 3, unitPrice: 80000, discountType: null, discountValue: 0, taxRate: 7.5 },
  ]);
  const abcInvoiceNumber = await allocateDocumentNumber(prisma, abc.id, 'INVOICE', zs);
  const abcInvoice = await prisma.invoice.create({
    data: {
      tenantId: abc.id,
      customerId: johnConstruction.id,
      isDemo: true,
      invoiceNumber: abcInvoiceNumber,
      invoiceDate: daysAgo(5),
      dueDate: daysAhead(10),
      status: 'UNPAID',
      subtotal: abcInvoiceItems.subtotal,
      discountAmount: abcInvoiceItems.discountAmount,
      taxAmount: abcInvoiceItems.taxAmount,
      total: abcInvoiceItems.total,
      amountPaid: 0,
      balanceDue: abcInvoiceItems.total,
      createdById: abcOwner.id,
      items: { create: itemRows(abcInvoiceItems.items) },
    },
  });

  console.log('\n  Seed complete.');
  console.log('  ─────────────────────────────────────────────');
  console.log('  Zarox Energy Company   admin@zarox-energy.com    / ChangeMe123!');
  console.log('  ABC Engineering Ltd    admin@abc-engineering.com / ChangeMe123!');
  console.log('  ⚠ Development accounts — change the passwords in production.\n');
}

/* ── helpers ──────────────────────────────────────────────────────── */

function itemRows(items) {
  return items.map((it, index) => ({
    productId: it.productId || null,
    description: it.description,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discountType: it.discountType ?? null,
    discountValue: it.discountValue ?? 0,
    discountAmount: it.discountAmount,
    taxRate: it.taxRate ?? 0,
    taxAmount: it.taxAmount,
    amount: it.amount,
    position: index,
  }));
}

/** Mirrors POST /api/invoices/:id/payments: payment → receipt → status. */
async function seedPayment(tenantId, userId, invoice, amount, paymentDate, paymentMethod, reference, notes) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        isDemo: true,
        amount,
        paymentDate,
        paymentMethod,
        reference,
        notes,
        createdById: userId,
      },
    });

    const receiptNumber = await allocateDocumentNumber(tx, tenantId, 'RECEIPT', null);
    await tx.receipt.create({
      data: {
        tenantId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        isDemo: true,
        customerId: invoice.customerId,
        receiptNumber,
        receiptDate: paymentDate,
        amount,
        paymentMethod,
        reference,
        description: `Payment received for invoice ${invoice.invoiceNumber}`,
        notes,
        createdById: userId,
      },
    });

    const freshPayments = await tx.payment.findMany({ where: { invoiceId: invoice.id } });
    const balance = computeBalance(invoice.total, freshPayments);
    const status = deriveInvoiceStatus({ total: invoice.total, amountPaid: balance.amountPaid, dueDate: invoice.dueDate, status: invoice.status });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: balance.amountPaid, balanceDue: balance.balanceDue, status },
    });

    return payment;
  });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
