/**
 * Demo / mock data generator — TG Invoice (tgeasy).
 *
 *   node prisma/demo-data.js                 → top up EVERY tenant
 *   node prisma/demo-data.js --tenant=zarox-energy
 *   node prisma/demo-data.js --reset         → clear demo data first, then regenerate
 *
 * Everything it creates is marked `isDemo: true`, so it can be wiped at any
 * time without touching real records:
 *
 *   npm run db:clear-demo
 *
 * It is safe to run repeatedly — by default it clears its own previous demo
 * records before writing fresh ones, so you never end up with duplicates.
 */
import { prisma } from '../src/prisma.js';
import { calculateDocumentTotals, deriveInvoiceStatus, computeBalance } from '../src/utils/money.js';
import { allocateDocumentNumber } from '../src/services/sequenceService.js';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const daysAhead = (n) => new Date(Date.now() + n * DAY);
const pick = (arr, i) => arr[i % arr.length];

/* ── Sample catalogue (kept generic so it fits any business) ─────────── */

const CUSTOMER_SEEDS = [
  { name: 'Chinedu Nwosu', companyName: 'Nwosu Ventures', email: 'chinedu@nwosuventures.ng', phone: '+234 803 111 2233', address: '14 Awolowo Road', city: 'Ikoyi', state: 'Lagos', country: 'Nigeria', notes: 'Repeat customer — net-14 terms.' },
  { name: 'Fatima Yusuf', companyName: 'Sahel Logistics Ltd', email: 'fatima@sahellogistics.ng', phone: '+234 806 222 3344', address: '22 Ahmadu Bello Way', city: 'Kaduna', state: 'Kaduna', country: 'Nigeria' },
  { name: 'Emeka Eze', companyName: 'Eze & Sons Ltd', email: 'emeka@ezesons.ng', phone: '+234 807 333 4455', address: '5 Ogui Road', city: 'Enugu', state: 'Enugu', country: 'Nigeria', taxId: 'TIN-44556611' },
  { name: 'Ngozi Adeleke', companyName: 'Bluepeak Interiors', email: 'ngozi@bluepeak.ng', phone: '+234 809 444 5566', address: '9 Admiralty Way, Lekki Phase 1', city: 'Lagos', state: 'Lagos', country: 'Nigeria' },
  { name: 'Ibrahim Musa', companyName: 'Northern Agro Ltd', email: 'ibrahim@northernagro.ng', phone: '+234 802 555 6677', address: '31 Kano Road', city: 'Kano', state: 'Kano', country: 'Nigeria' },
  { name: 'Blessing Etim', companyName: 'Coastline Hotels', email: 'blessing@coastlinehotels.ng', phone: '+234 805 666 7788', address: '1 Marina Close', city: 'Calabar', state: 'Cross River', country: 'Nigeria', notes: 'Prefers POS payments.' },
  { name: 'Segun Alabi', companyName: 'Alabi Autos', email: 'segun@alabiautos.ng', phone: '+234 803 777 8899', address: '77 Ikorodu Road', city: 'Ikeja', state: 'Lagos', country: 'Nigeria' },
  { name: 'Halima Sani', companyName: 'Sani Pharma', email: 'halima@sanipharma.ng', phone: '+234 808 888 9900', address: '18 Sultan Bello Road', city: 'Sokoto', state: 'Sokoto', country: 'Nigeria' },
  { name: 'Victor Ogbonna', companyName: 'Ogbonna Constructions', email: 'victor@ogbonnaconstructions.ng', phone: '+234 806 999 0011', address: '4 Aba Road', city: 'Port Harcourt', state: 'Rivers', country: 'Nigeria' },
  { name: 'Precious Nnamdi', companyName: 'Nnamdi Foods', email: 'precious@nnamdifoods.ng', phone: '+234 807 101 2020', address: '12 Onitsha Main Market', city: 'Onitsha', state: 'Anambra', country: 'Nigeria' },
];

const PRODUCT_SEEDS = [
  { name: 'Consulting Session', description: 'Professional consulting engagement (per hour).', category: 'CONSULTATION', unit: 'hour', unitPrice: 25000, taxRate: 7.5 },
  { name: 'Installation Service', description: 'On-site installation and commissioning.', category: 'TECHNICAL_SERVICE', unit: 'job', unitPrice: 120000, taxRate: 7.5 },
  { name: 'Annual Maintenance', description: 'Preventive maintenance contract for 12 months.', category: 'TECHNICAL_SERVICE', unit: 'contract', unitPrice: 350000, taxRate: 7.5 },
  { name: 'Supply of Materials', description: 'Supply of project materials and consumables.', category: 'EQUIPMENT', unit: 'lot', unitPrice: 90000, taxRate: 7.5 },
  { name: 'Site Survey', description: 'Detailed site survey and feasibility report.', category: 'CONSULTATION', unit: 'survey', unitPrice: 60000, taxRate: 7.5 },
  { name: 'Training Workshop', description: 'Staff training workshop (per participant).', category: 'CONSULTATION', unit: 'participant', unitPrice: 45000, taxRate: 0 },
  { name: 'Project Management', description: 'End-to-end project management and coordination.', category: 'ENERGY_SERVICE', unit: 'project', unitPrice: 280000, taxRate: 7.5 },
  { name: 'Equipment Rental', description: 'Equipment rental, billed per day.', category: 'EQUIPMENT', unit: 'day', unitPrice: 55000, taxRate: 7.5 },
];

/** Quotation blueprints — statuses cover the whole lifecycle. */
const QUOTATION_SEEDS = [
  { customer: 0, status: 'DRAFT', age: 2, valid: 28, items: [{ p: 0, qty: 3 }, { p: 4, qty: 1 }], notes: 'Draft — pending final scope confirmation.' },
  { customer: 1, status: 'SENT', age: 6, valid: 24, items: [{ p: 1, qty: 1 }], reference: 'RFQ-2026-041' },
  { customer: 2, status: 'SENT', age: 9, valid: 21, items: [{ p: 2, qty: 1 }, { p: 6, qty: 1 }] },
  { customer: 3, status: 'ACCEPTED', age: 14, valid: 16, items: [{ p: 3, qty: 2 }] },
  { customer: 4, status: 'ACCEPTED', age: 20, valid: 10, items: [{ p: 5, qty: 8 }, { p: 0, qty: 4 }] },
  { customer: 5, status: 'REJECTED', age: 25, valid: 5, items: [{ p: 7, qty: 10 }], notes: 'Client opted for an in-house solution.' },
  { customer: 6, status: 'EXPIRED', age: 62, valid: 32, items: [{ p: 2, qty: 1 }] },
];

/**
 * Invoice blueprints.
 *  pay: 'full' | 'part' | null ; part = fraction of total
 *  draft / cancelled are created without auto status derivation.
 */
const INVOICE_SEEDS = [
  { customer: 0, kind: 'draft', age: 1, due: 15, items: [{ p: 0, qty: 2 }] },
  { customer: 1, kind: 'unpaid', age: 4, due: 11, items: [{ p: 1, qty: 1 }, { p: 4, qty: 2 }], reference: 'PO-88410' },
  { customer: 2, kind: 'sent', age: 7, due: 8, items: [{ p: 3, qty: 3 }] },
  { customer: 3, kind: 'part', age: 12, due: 3, part: 0.4, items: [{ p: 2, qty: 1 }, { p: 0, qty: 6 }] },
  { customer: 4, kind: 'part', age: 18, due: -2, part: 0.55, items: [{ p: 6, qty: 1 }] },
  { customer: 5, kind: 'paid', age: 22, due: -8, items: [{ p: 5, qty: 12 }] },
  { customer: 6, kind: 'paid', age: 30, due: -16, items: [{ p: 7, qty: 6 }, { p: 1, qty: 1 }] },
  { customer: 7, kind: 'overdue', age: 40, due: -12, items: [{ p: 2, qty: 1 }] },
  { customer: 8, kind: 'overdue', age: 52, due: -24, items: [{ p: 3, qty: 4 }] },
  { customer: 9, kind: 'cancelled', age: 26, due: -6, items: [{ p: 0, qty: 1 }], notes: 'Cancelled at the customer\u2019s request.' },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

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

function buildItems(products, specs, fallbackTaxRate) {
  return specs.map((s) => {
    const product = pick(products, s.p ?? 0);
    return {
      productId: product.id,
      description: s.description || product.name,
      quantity: s.qty ?? 1,
      unitPrice: s.unitPrice ?? product.unitPrice,
      discountType: s.discountType ?? null,
      discountValue: s.discountValue ?? 0,
      taxRate: s.taxRate ?? product.taxRate ?? fallbackTaxRate ?? 0,
    };
  });
}

/** Align each numbering sequence to the highest number already issued. */
async function syncSequences(tenantId, settings) {
  const prefixes = {
    CUSTOMER: settings?.customerPrefix || 'CUS',
    QUOTATION: settings?.quotationPrefix || 'QT',
    INVOICE: settings?.invoicePrefix || 'INV',
    RECEIPT: settings?.receiptPrefix || 'REC',
  };
  const kinds = [
    { kind: 'CUSTOMER', model: 'customer', field: 'customerCode' },
    { kind: 'QUOTATION', model: 'quotation', field: 'quotationNumber' },
    { kind: 'INVOICE', model: 'invoice', field: 'invoiceNumber' },
    { kind: 'RECEIPT', model: 'receipt', field: 'receiptNumber' },
  ];
  for (const { kind, model, field } of kinds) {
    const rows = await prisma[model].findMany({ where: { tenantId }, select: { [field]: true } });
    let max = 0;
    for (const row of rows) {
      const match = /(\d+)\s*$/.exec(row[field] || '');
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    await prisma.documentSequence.upsert({
      where: { tenantId_kind: { tenantId, kind } },
      create: { tenantId, kind, prefix: prefixes[kind], next: max + 1 },
      update: { next: max + 1 },
    });
  }
}

/** Recompute an invoice's amountPaid / balanceDue / status from its payments. */
async function refreshInvoice(db, invoiceId) {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return;
  const payments = await db.payment.findMany({ where: { invoiceId } });
  const balance = computeBalance(invoice.total, payments);
  const status = deriveInvoiceStatus({
    total: invoice.total,
    amountPaid: balance.amountPaid,
    dueDate: invoice.dueDate,
    status: invoice.status,
  });
  await db.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: balance.amountPaid, balanceDue: balance.balanceDue, status },
  });
}

/** Mirrors POST /api/invoices/:id/payments: payment → receipt → status refresh. */
async function recordPayment(settings, tenantId, userId, invoice, amount, paymentDate, paymentMethod, reference, notes) {
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

    const receiptNumber = await allocateDocumentNumber(tx, tenantId, 'RECEIPT', settings);
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

    await refreshInvoice(tx, invoice.id);
    return payment;
  });
}

/* ── Per-tenant generation ───────────────────────────────────────────── */

async function clearDemoData(tenantId) {
  const where = { isDemo: true, tenantId };
  await prisma.receipt.deleteMany({ where });
  await prisma.payment.deleteMany({ where });
  await prisma.invoice.deleteMany({ where });
  await prisma.quotation.deleteMany({ where });
  await prisma.product.deleteMany({ where });
  await prisma.customer.deleteMany({ where });
}

async function generateForTenant(tenant) {
  const settings = await prisma.companySettings.findUnique({ where: { tenantId: tenant.id } });
  const settingsArg = settings
    ? {
        customerPrefix: 'CUS',
        quotationPrefix: settings.quotationPrefix,
        invoicePrefix: settings.invoicePrefix,
        receiptPrefix: settings.receiptPrefix,
      }
    : null;
  const taxRate = Number(settings?.defaultTaxRate ?? 0) || 0;

  const member =
    (await prisma.membership.findFirst({ where: { tenantId: tenant.id, role: { in: ['OWNER', 'ADMIN'] } } })) ||
    (await prisma.membership.findFirst({ where: { tenantId: tenant.id } }));
  const userId = member?.userId || null;

  await syncSequences(tenant.id, settings);

  /* Customers */
  const customers = [];
  for (const seed of CUSTOMER_SEEDS) {
    const customerCode = await allocateDocumentNumber(prisma, tenant.id, 'CUSTOMER', settingsArg);
    customers.push(
      await prisma.customer.create({ data: { tenantId: tenant.id, isDemo: true, customerCode, ...seed } })
    );
  }

  /* Products */
  const products = [];
  for (const seed of PRODUCT_SEEDS) {
    products.push(
      await prisma.product.create({ data: { tenantId: tenant.id, isDemo: true, taxRate, ...seed } })
    );
  }

  /* Quotations */
  const quotations = [];
  for (const seed of QUOTATION_SEEDS) {
    const totals = calculateDocumentTotals(buildItems(products, seed.items, taxRate));
    const quotationNumber = await allocateDocumentNumber(prisma, tenant.id, 'QUOTATION', settingsArg);
    const quotation = await prisma.quotation.create({
      data: {
        tenantId: tenant.id,
        customerId: customers[seed.customer].id,
        isDemo: true,
        quotationNumber,
        quotationDate: daysAgo(seed.age),
        validUntil: daysAhead(seed.valid),
        reference: seed.reference || null,
        status: seed.status,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        notes: seed.notes || null,
        terms: settings?.defaultQuotationTerms || 'This quotation is valid for 30 days from the date of issue.',
        createdById: userId,
        items: { create: itemRows(totals.items) },
      },
    });
    quotations.push(quotation);
  }

  /* Invoices */
  const invoices = [];
  for (const seed of INVOICE_SEEDS) {
    const totals = calculateDocumentTotals(buildItems(products, seed.items, taxRate));
    const invoiceNumber = await allocateDocumentNumber(prisma, tenant.id, 'INVOICE', settingsArg);
    const initialStatus = seed.kind === 'draft' ? 'DRAFT' : seed.kind === 'cancelled' ? 'CANCELLED' : seed.kind === 'sent' ? 'SENT' : 'UNPAID';
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        customerId: customers[seed.customer].id,
        isDemo: true,
        invoiceNumber,
        invoiceDate: daysAgo(seed.age),
        dueDate: daysAhead(seed.due),
        reference: seed.reference || null,
        status: initialStatus,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        amountPaid: 0,
        balanceDue: totals.total,
        notes: seed.notes || settings?.defaultInvoiceNotes || null,
        createdById: userId,
        items: { create: itemRows(totals.items) },
      },
    });
    invoices.push(invoice);
  }

  /* A converted quotation → invoice (invoice #0 also links back) */
  const accepted = quotations.find((q) => q.status === 'ACCEPTED');
  if (accepted) {
    await prisma.quotation.update({ where: { id: accepted.id }, data: { status: 'CONVERTED' } });
    await prisma.invoice.update({ where: { id: invoices[0].id }, data: { quotationId: accepted.id } });
  }

  /* Payments + receipts for paid / partially-paid invoices */
  const methods = ['BANK_TRANSFER', 'POS', 'CASH', 'ONLINE', 'CHEQUE'];
  let methodIndex = 0;
  for (let i = 0; i < INVOICE_SEEDS.length; i += 1) {
    const seed = INVOICE_SEEDS[i];
    const invoice = invoices[i];
    const total = Number(invoice.total);

    if (seed.kind === 'paid') {
      await recordPayment(settingsArg, tenant.id, userId, invoice, total, daysAgo(Math.max(seed.age - 3, 1)), pick(methods, methodIndex++), `TRX-${100000 + i}`, 'Payment received in full.');
    } else if (seed.kind === 'part') {
      const part = Math.round(total * (seed.part ?? 0.5) * 100) / 100;
      await recordPayment(settingsArg, tenant.id, userId, invoice, part, daysAgo(Math.max(seed.age - 4, 1)), pick(methods, methodIndex++), `TRX-${200000 + i}`, 'Part payment — balance outstanding.');
    } else {
      // Derive status for unpaid / overdue / sent / draft / cancelled.
      await refreshInvoice(prisma, invoice.id);
    }
  }

  return { customers: customers.length, products: products.length, quotations: quotations.length, invoices: invoices.length };
}

/* ── Entry point ─────────────────────────────────────────────────────── */

async function main() {
  const reset = process.argv.includes('--reset');
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const slug = tenantArg ? tenantArg.split('=')[1] : null;

  const tenants = await prisma.tenant.findMany({
    where: slug ? { slug } : undefined,
    orderBy: { createdAt: 'asc' },
  });

  if (tenants.length === 0) {
    console.log(slug ? `No tenant found with slug "${slug}".` : 'No tenants found. Run the seed first.');
    return;
  }

  if (reset) {
    console.log('Clearing existing demo data…');
    for (const tenant of tenants) await clearDemoData(tenant.id);
  }

  console.log(`\nGenerating demo data for ${tenants.length} tenant(s)…\n`);
  let totals = { customers: 0, products: 0, quotations: 0, invoices: 0 };
  for (const tenant of tenants) {
    // Always start from a clean demo slate so re-runs don't duplicate.
    await clearDemoData(tenant.id);
    const counts = await generateForTenant(tenant);
    totals = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v + counts[k]]));
    console.log(`  ✓ ${tenant.name.padEnd(28)} ${counts.customers} customers · ${counts.products} products · ${counts.quotations} quotations · ${counts.invoices} invoices`);
  }

  console.log('\n  Demo data ready.');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Totals: ${totals.customers} customers, ${totals.products} products, ${totals.quotations} quotations, ${totals.invoices} invoices`);
  console.log('  Remove it any time with:  npm run db:clear-demo\n');
}

main()
  .catch((err) => {
    console.error('Demo data generation failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
