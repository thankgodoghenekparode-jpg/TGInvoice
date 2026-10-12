/**
 * Tenant isolation security tests (spec §62 / §90).
 *
 * Proves that Tenant A cannot read, modify, delete or operate on any
 * Tenant B resource — through the REAL HTTP API, with real JWTs.
 *
 * Requires: a reachable PostgreSQL (DATABASE_URL) and `npx prisma generate`.
 * Run: npm test
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
let userA, userB, tenantA, tenantB, invoiceA, invoiceB, customerB;
let tokenA, tokenB;

async function listen() {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
}

async function api(method, path, { token, tenant, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenant) headers['X-Tenant-Id'] = tenant;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (pdf etc.) */
  }
  return { status: res.status, json };
}

async function makeTenant({ slug, name, ownerEmail, invoiceNumber, customerName }) {
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const user = await prisma.user.create({ data: { name: `Owner ${slug}`, email: ownerEmail, passwordHash, emailVerified: true } });
  const tenant = await prisma.tenant.create({ data: { name, slug } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.companySettings.create({ data: { tenantId: tenant.id, businessName: name, currency: 'NGN', currencySymbol: '₦' } });
  for (const kind of ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT']) {
    await prisma.documentSequence.create({
      data: { tenantId: tenant.id, kind, prefix: kind === 'CUSTOMER' ? 'CUS' : kind === 'QUOTATION' ? 'QT' : kind === 'RECEIPT' ? 'REC' : 'INV', next: 1 },
    });
  }

  const customer = await prisma.customer.create({
    data: { tenantId: tenant.id, customerCode: 'CUS-00001', name: customerName, companyName: `${customerName} Ltd` },
  });
  const invoice = await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 86400000),
      status: 'UNPAID',
      subtotal: 100000,
      discountAmount: 0,
      taxAmount: 7500,
      total: 107500,
      amountPaid: 0,
      balanceDue: 107500,
      items: {
        create: [{ description: 'Service', quantity: 1, unitPrice: 100000, discountValue: 0, discountAmount: 0, taxRate: 7.5, taxAmount: 7500, amount: 107500 }],
      },
    },
  });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ownerEmail, password: 'ChangeMe123!' }),
  });
  const loginJson = await login.json();
  assert.equal(login.status, 200, `login for ${ownerEmail} must succeed`);

  return { user, tenant, customer, invoice, token: loginJson.data.accessToken };
}

before(async () => {
  await listen();

  // Isolated test tenants (cleaned up afterwards).
  userA = await makeTenant({ slug: 'iso-tenant-a', name: 'Isolation Tenant A', ownerEmail: 'iso-a@test.local', invoiceNumber: 'INV-00001', customerName: 'Customer A' });
  userB = await makeTenant({ slug: 'iso-tenant-b', name: 'Isolation Tenant B', ownerEmail: 'iso-b@test.local', invoiceNumber: 'INV-00001', customerName: 'Customer B' });

  tenantA = userA.tenant;
  tenantB = userB.tenant;
  invoiceA = userA.invoice;
  invoiceB = userB.invoice;
  customerB = userB.customer;
  tokenA = userA.token;
  tokenB = userB.token;
});

after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: ['iso-tenant-a', 'iso-tenant-b'] } } });
  await prisma.user.deleteMany({ where: { email: { in: ['iso-a@test.local', 'iso-b@test.local'] } } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('both tenants can issue the same invoice number independently', async () => {
  const a = await api('GET', `/api/invoices/${invoiceA.id}`, { token: tokenA, tenant: tenantA.id });
  const b = await api('GET', `/api/invoices/${invoiceB.id}`, { token: tokenB, tenant: tenantB.id });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.json.data.invoiceNumber, 'INV-00001');
  assert.equal(b.json.data.invoiceNumber, 'INV-00001');
});

test('Tenant A list only ever contains Tenant A invoices', async () => {
  const res = await api('GET', '/api/invoices', { token: tokenA, tenant: tenantA.id });
  assert.equal(res.status, 200);
  const ids = res.json.data.map((i) => i.id);
  assert.ok(ids.includes(invoiceA.id));
  assert.ok(!ids.includes(invoiceB.id), 'Tenant B invoice must never appear in Tenant A list');
});

test('Tenant A cannot GET Tenant B invoice (404, no existence leak)', async () => {
  const res = await api('GET', `/api/invoices/${invoiceB.id}`, { token: tokenA, tenant: tenantA.id });
  assert.equal(res.status, 404);
});

test('Tenant A cannot UPDATE Tenant B customer', async () => {
  const res = await api('PUT', `/api/customers/${customerB.id}`, {
    token: tokenA,
    tenant: tenantA.id,
    body: { name: 'Hijacked Name' },
  });
  assert.equal(res.status, 404);

  const untouched = await prisma.customer.findUnique({ where: { id: customerB.id } });
  assert.equal(untouched.name, 'Customer B', 'Tenant B customer must remain unchanged');
});

test('Tenant A cannot DELETE Tenant B invoice', async () => {
  const res = await api('DELETE', `/api/invoices/${invoiceB.id}`, { token: tokenA, tenant: tenantA.id });
  assert.equal(res.status, 404);
  const still = await prisma.invoice.findUnique({ where: { id: invoiceB.id } });
  assert.ok(still, 'Tenant B invoice must still exist');
});

test('Tenant A cannot operate inside Tenant B via a forged tenant header', async () => {
  for (const path of ['/api/reports/dashboard', '/api/settings', '/api/customers', '/api/team', '/api/audit-logs']) {
    const res = await api('GET', path, { token: tokenA, tenant: tenantB.id });
    assert.equal(res.status, 403, `${path} must reject forged X-Tenant-Id`);
    assert.ok(!JSON.stringify(res.json).includes('Isolation Tenant B'), 'no Tenant B data may leak');
  }
});

test('Tenant A cannot switch to Tenant B', async () => {
  const res = await api('POST', '/api/tenants/switch', { token: tokenA, body: { tenantId: tenantB.id } });
  assert.equal(res.status, 403);
});

test('Tenant A cannot record a payment on Tenant B invoice', async () => {
  const res = await api('POST', `/api/invoices/${invoiceB.id}/payments`, {
    token: tokenA,
    tenant: tenantA.id,
    body: { amount: 1000, paymentMethod: 'CASH' },
  });
  assert.equal(res.status, 404);
});

test('Tenant A cannot access Tenant B settings or logo/payment information', async () => {
  const res = await api('GET', '/api/settings', { token: tokenA, tenant: tenantB.id });
  assert.equal(res.status, 403);
});

test('unauthenticated requests are rejected', async () => {
  const res = await api('GET', '/api/invoices');
  assert.equal(res.status, 401);
});

test('search never crosses tenant boundaries', async () => {
  const res = await api('GET', '/api/search?q=Customer', { token: tokenA, tenant: tenantA.id });
  assert.equal(res.status, 200);
  const found = JSON.stringify(res.json.data.customers);
  assert.ok(!found.includes('Customer B'), 'Tenant B customer must not appear in Tenant A search');
});
