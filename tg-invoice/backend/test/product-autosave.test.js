/**
 * Auto-save custom line items into the tenant's product catalogue.
 *
 * Businesses often type items inline (they don't want to pre-create hundreds
 * of products before invoicing). This proves those typed items become reusable
 * Products & services — without ever creating duplicates, and only when the
 * caller opts in.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import app from '../src/app.js';

let server;
let base;
let tenant;
let token;
let customer;

async function api(method, path, { body } = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant.id };
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const user = await prisma.user.create({
    data: { name: 'Autosave Owner', email: 'autosave@test.local', passwordHash, emailVerified: true },
  });
  tenant = await prisma.tenant.create({ data: { name: 'Autosave Co', slug: 'autosave-tenant' } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.companySettings.create({ data: { tenantId: tenant.id, businessName: 'Autosave Co', currency: 'NGN', currencySymbol: '₦' } });
  for (const kind of ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT']) {
    await prisma.documentSequence.create({
      data: { tenantId: tenant.id, kind, prefix: kind === 'CUSTOMER' ? 'CUS' : kind === 'QUOTATION' ? 'QT' : kind === 'RECEIPT' ? 'REC' : 'INV', next: 1 },
    });
  }
  customer = await prisma.customer.create({ data: { tenantId: tenant.id, customerCode: 'CUS-00001', name: 'Autosave Customer' } });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'autosave@test.local', password: 'ChangeMe123!' }),
  });
  const loginJson = await login.json();
  assert.equal(login.status, 200, 'login must succeed');
  token = loginJson.data.accessToken;
});

after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: 'autosave-tenant' } });
  await prisma.user.deleteMany({ where: { email: 'autosave@test.local' } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const invoicePayload = (items, extra = {}) => ({
  customerId: customer.id,
  invoiceDate: new Date().toISOString().slice(0, 10),
  items,
  ...extra,
});

test('typing a custom invoice item saves it to Products & services and links the line', async () => {
  const res = await api('POST', '/api/invoices', {
    body: invoicePayload([{ description: 'Website design', quantity: 1, unitPrice: 120000, taxRate: 7.5 }]),
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));

  const product = await prisma.product.findFirst({ where: { tenantId: tenant.id, name: 'Website design' } });
  assert.ok(product, 'a product named after the typed item must exist');
  assert.equal(product.category, 'Other');
  assert.equal(Number(product.unitPrice), 120000);

  const invoice = await prisma.invoice.findUnique({ where: { id: res.json.data.id }, include: { items: true } });
  assert.equal(invoice.items[0].productId, product.id, 'the line must link to the auto-created product');
});

test('repeating the same typed item never duplicates the product', async () => {
  const before = await prisma.product.count({ where: { tenantId: tenant.id, name: 'Website design' } });

  const res = await api('POST', '/api/invoices', {
    body: invoicePayload([{ description: '  website   DESIGN ', quantity: 1, unitPrice: 90000 }]),
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));

  const after = await prisma.product.count({ where: { tenantId: tenant.id, name: { equals: 'Website design', mode: 'insensitive' } } });
  assert.equal(before, 1);
  assert.equal(after, 1, 'case/whitespace differences must not create a duplicate');
});

test('opt-out (saveCustomItems:false) leaves the catalogue untouched', async () => {
  const name = 'One-off delivery fee';
  const res = await api('POST', '/api/invoices', {
    body: invoicePayload([{ description: name, quantity: 1, unitPrice: 5000 }], { saveCustomItems: false }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const count = await prisma.product.count({ where: { tenantId: tenant.id, name } });
  assert.equal(count, 0, 'no product should be created when the caller opts out');
});

test('typing a custom quotation item also saves it', async () => {
  const res = await api('POST', '/api/quotations', {
    body: {
      customerId: customer.id,
      quotationDate: new Date().toISOString().slice(0, 10),
      items: [{ description: 'SEO retainer', quantity: 3, unitPrice: 40000 }],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const product = await prisma.product.findFirst({ where: { tenantId: tenant.id, name: 'SEO retainer' } });
  assert.ok(product, 'custom quotation items must be saved too');
});

test('picking an existing product is not re-created', async () => {
  const existing = await prisma.product.findFirst({ where: { tenantId: tenant.id, name: 'Website design' } });
  const res = await api('POST', '/api/invoices', {
    body: invoicePayload([{ productId: existing.id, description: 'Website design', quantity: 1, unitPrice: 120000 }]),
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const count = await prisma.product.count({ where: { tenantId: tenant.id, name: 'Website design' } });
  assert.equal(count, 1);
});
