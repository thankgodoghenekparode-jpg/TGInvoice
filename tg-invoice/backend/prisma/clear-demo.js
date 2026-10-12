/**
 * Remove every record created by the demo seeder (isDemo = true) from TG Invoice.
 *
 *   npm run db:clear-demo
 *   node prisma/clear-demo.js --tenant=zarox-energy
 *
 * Only rows flagged `isDemo` are deleted — real, hand-entered records are
 * never touched. Deletion order respects foreign keys: receipts → payments →
 * invoices → quotations → products → customers.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearTenant(tenant) {
  const where = { isDemo: true, tenantId: tenant.id };
  const counts = {};

  counts.receipts = (await prisma.receipt.deleteMany({ where })).count;
  counts.payments = (await prisma.payment.deleteMany({ where })).count;
  counts.invoices = (await prisma.invoice.deleteMany({ where })).count; // line items cascade
  counts.quotations = (await prisma.quotation.deleteMany({ where })).count; // line items cascade

  try {
    counts.products = (await prisma.product.deleteMany({ where })).count;
    counts.customers = (await prisma.customer.deleteMany({ where })).count;
  } catch (err) {
    if (err?.code === 'P2003') {
      console.warn(
        `  ! Some demo products/customers in "${tenant.name}" are still referenced by non-demo records and were kept.`
      );
    } else {
      throw err;
    }
  }

  return counts;
}

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const slug = tenantArg ? tenantArg.split('=')[1] : null;

  const tenants = await prisma.tenant.findMany({
    where: slug ? { slug } : undefined,
    orderBy: { createdAt: 'asc' },
  });

  if (tenants.length === 0) {
    console.log('No matching tenants — nothing to clear.');
    return;
  }

  console.log(`\nClearing demo data for ${tenants.length} tenant(s)…\n`);
  const totals = { receipts: 0, payments: 0, invoices: 0, quotations: 0, products: 0, customers: 0 };

  for (const tenant of tenants) {
    const counts = await clearTenant(tenant);
    for (const key of Object.keys(totals)) totals[key] += counts[key] || 0;
    console.log(
      `  ✓ ${tenant.name.padEnd(28)} removed ${counts.receipts || 0} receipts, ${counts.payments || 0} payments, ${counts.invoices || 0} invoices, ${counts.quotations || 0} quotations, ${counts.products || 0} products, ${counts.customers || 0} customers`
    );
  }

  console.log('\n  Demo data cleared.');
  console.log('  ─────────────────────────────────────────────');
  console.log(
    `  Totals: ${totals.customers} customers, ${totals.products} products, ${totals.quotations} quotations, ${totals.invoices} invoices, ${totals.payments} payments, ${totals.receipts} receipts\n`
  );
}

main()
  .catch((err) => {
    console.error('Failed to clear demo data:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
