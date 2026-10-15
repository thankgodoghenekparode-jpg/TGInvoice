/**
 * Credit notes, refunds and invoice void.
 *
 * The invariants that matter:
 *   - applying a credit note settles an invoice through a CREDIT_NOTE payment,
 *     so balanceDue stays consistent with the payments ledger everywhere;
 *   - a credit note can never be over-applied, and only unapplied credit is
 *     refundable;
 *   - an invoice touched by money cannot be voided (a credit note is the
 *     correct reversal);
 *   - everything is tenant-scoped.
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
let invoice; // total 1000, unpaid

const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant.id });

async function api(method, path, { body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (e.g. PDF) */
  }
  return { status: res.status, json, res };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const user = await prisma.user.create({
    data: { name: 'Credits Owner', email: 'credits@test.local', passwordHash, emailVerified: true },
  });
  tenant = await prisma.tenant.create({ data: { name: 'Credits Co', slug: 'credits-tenant' } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.companySettings.create({ data: { tenantId: tenant.id, businessName: 'Credits Co' } });
  for (const [kind, prefix] of [
    ['CUSTOMER', 'CUS'],
    ['INVOICE', 'INV'],
    ['RECEIPT', 'REC'],
    ['CREDIT_NOTE', 'CN'],
    ['REFUND', 'REF'],
  ]) {
    await prisma.documentSequence.create({ data: { tenantId: tenant.id, kind, prefix, next: 1 } });
  }

  customer = await prisma.customer.create({
    data: { tenantId: tenant.id, customerCode: 'CUS-00001', name: 'Ada Obi', email: 'ada@example.com', phone: '08031234567' },
  });

  invoice = await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      invoiceNumber: 'INV-00001',
      status: 'UNPAID',
      subtotal: 1000,
      total: 1000,
      amountPaid: 0,
      balanceDue: 1000,
      items: { create: [{ description: 'Consulting', quantity: 1, unitPrice: 1000, amount: 1000 }] },
    },
  });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'credits@test.local', password: 'ChangeMe123!' }),
  });
  const loginJson = await login.json();
  assert.equal(login.status, 200, 'login must succeed');
  token = loginJson.data.accessToken;
});

after(async () => {
  await prisma.refund.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.payment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.creditNote.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.invoice.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.customer.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.product.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.documentSequence.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.companySettings.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.membership.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.deleteMany({ where: { slug: 'credits-tenant' } });
  await prisma.user.deleteMany({ where: { email: 'credits@test.local' } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

/* ── credit notes: lifecycle ──────────────────────────────────────── */

test('a credit note is created as a draft with a CN number and computed totals', async () => {
  const res = await api('POST', '/api/credit-notes', {
    body: {
      customerId: customer.id,
      invoiceId: invoice.id,
      reason: 'Returned item',
      items: [
        { description: 'Consulting', quantity: 1, unitPrice: 1000, taxRate: 7.5 },
      ],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.creditNoteNumber, 'CN-00001');
  assert.equal(res.json.data.status, 'DRAFT');
  assert.equal(res.json.data.subtotal, 1000);
  assert.equal(res.json.data.taxAmount, 75);
  assert.equal(res.json.data.total, 1075);
  assert.equal(res.json.data.amountApplied, 0);
  assert.equal(res.json.data.creditRemaining, 1075);
  assert.equal(res.json.data.invoice.invoiceNumber, 'INV-00001');
});

test('a draft credit note can be edited, then another customer rejected', async () => {
  const list = await api('GET', '/api/credit-notes?search=Returned');
  assert.equal(list.status, 200);
  const cn = list.json.data[0];

  const updated = await api('PUT', `/api/credit-notes/${cn.id}`, {
    body: {
      customerId: customer.id,
      items: [{ description: 'Consulting', quantity: 1, unitPrice: 500 }],
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.data.total, 500);

  const foreign = await api('POST', '/api/credit-notes', {
    body: { customerId: '00000000-0000-0000-0000-000000000000', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] },
  });
  assert.equal(foreign.status, 400);
});

test('a draft can be deleted, but an issued credit note cannot', async () => {
  const created = await api('POST', '/api/credit-notes', {
    body: { customerId: customer.id, items: [{ description: 'Scratch', quantity: 1, unitPrice: 10 }] },
  });
  const draftId = created.json.data.id;

  const del = await api('DELETE', `/api/credit-notes/${draftId}`);
  assert.equal(del.status, 200);

  const cn = await prisma.creditNote.findFirst({ where: { tenantId: tenant.id, status: 'DRAFT' } });
  const issued = await api('POST', `/api/credit-notes/${cn.id}/issue`);
  assert.equal(issued.status, 200);
  assert.equal(issued.json.data.status, 'ISSUED');

  const blocked = await api('DELETE', `/api/credit-notes/${cn.id}`);
  assert.equal(blocked.status, 400);
});

/* ── applying credit ──────────────────────────────────────────────── */

let appliedCnId;

test('applying a credit note settles the invoice through a CREDIT_NOTE payment', async () => {
  // Issue a 300 credit note against the invoice.
  const created = await api('POST', '/api/credit-notes', {
    body: {
      customerId: customer.id,
      invoiceId: invoice.id,
      items: [{ description: 'Discount', quantity: 1, unitPrice: 300 }],
    },
  });
  appliedCnId = created.json.data.id;
  await api('POST', `/api/credit-notes/${appliedCnId}/issue`);

  const applied = await api('POST', `/api/credit-notes/${appliedCnId}/apply`, { body: {} });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal(applied.json.data.applied, 300);
  assert.equal(applied.json.data.invoice.balanceDue, 700);
  assert.equal(applied.json.data.invoice.status, 'PARTIALLY_PAID');
  assert.equal(applied.json.data.creditNote.amountApplied, 300);
  assert.equal(applied.json.data.creditNote.creditRemaining, 0);
  assert.equal(applied.json.data.creditNote.status, 'APPLIED');

  const payment = await prisma.payment.findFirst({ where: { invoiceId: invoice.id } });
  assert.equal(payment.paymentMethod, 'CREDIT_NOTE');
  assert.equal(Number(payment.amount), 300);

  // The invoice's stored ledger now agrees with its stored balance.
  const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(Number(fresh.amountPaid), 300);
  assert.equal(Number(fresh.balanceDue), 700);
});

test('a fully applied credit note cannot be applied again', async () => {
  const res = await api('POST', `/api/credit-notes/${appliedCnId}/apply`, { body: {} });
  assert.equal(res.status, 400);
});

test('a partial application can be requested explicitly and caps at the remainder', async () => {
  const created = await api('POST', '/api/credit-notes', {
    body: { customerId: customer.id, invoiceId: invoice.id, items: [{ description: 'More credit', quantity: 1, unitPrice: 500 }] },
  });
  const cnId = created.json.data.id;
  await api('POST', `/api/credit-notes/${cnId}/issue`);

  const partial = await api('POST', `/api/credit-notes/${cnId}/apply`, { body: { amount: 200 } });
  assert.equal(partial.status, 200, JSON.stringify(partial.json));
  assert.equal(partial.json.data.applied, 200);
  assert.equal(partial.json.data.creditNote.amountApplied, 200);
  assert.equal(partial.json.data.creditNote.status, 'ISSUED');
  assert.equal(partial.json.data.invoice.balanceDue, 500);

  // Asking for more than remains is capped, not rejected.
  const rest = await api('POST', `/api/credit-notes/${cnId}/apply`, { body: { amount: 999999 } });
  assert.equal(rest.status, 200);
  assert.equal(rest.json.data.applied, 300);
  assert.equal(rest.json.data.creditNote.status, 'APPLIED');
  assert.equal(rest.json.data.invoice.balanceDue, 200);
});

test('applying over the invoice outstanding balance is capped at the balance', async () => {
  // Invoice now owes 200. A 500 credit note can only absorb 200.
  const created = await api('POST', '/api/credit-notes', {
    body: { customerId: customer.id, invoiceId: invoice.id, items: [{ description: 'Big credit', quantity: 1, unitPrice: 500 }] },
  });
  const cnId = created.json.data.id;
  await api('POST', `/api/credit-notes/${cnId}/issue`);

  const applied = await api('POST', `/api/credit-notes/${cnId}/apply`, { body: {} });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal(applied.json.data.applied, 200);
  assert.equal(applied.json.data.invoice.balanceDue, 0);
  assert.equal(applied.json.data.invoice.status, 'PAID');
  // 300 credit remains available.
  assert.equal(applied.json.data.creditNote.amountApplied, 200);
  assert.equal(applied.json.data.creditNote.creditRemaining, 300);
  assert.equal(applied.json.data.creditNote.status, 'ISSUED');
});

test('a credit note cannot be voided once credit has been applied', async () => {
  const res = await api('POST', `/api/credit-notes/${appliedCnId}/void`, { body: { reason: 'oops' } });
  assert.equal(res.status, 400);
});

test('PDF and share endpoints work for a credit note', async () => {
  const pdf = await api('GET', `/api/credit-notes/${appliedCnId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.res.headers.get('content-type'), /application\/pdf/);

  const share = await api('GET', `/api/credit-notes/${appliedCnId}/share`);
  assert.equal(share.status, 200);
  assert.match(share.json.data.text, /Credit note/);
  assert.ok(share.json.data.previewUrl.includes('/api/public/documents/'));
});

/* ── refunds ──────────────────────────────────────────────────────── */

test('a refund capped by remaining credit note credit is recorded and listed', async () => {
  // appliedCnId is fully applied (nothing refundable). Use the 300-remaining note.
  const cn = await prisma.creditNote.findFirst({
    where: { tenantId: tenant.id, amountApplied: { equals: 200 } },
    orderBy: { createdAt: 'desc' },
  });

  const created = await api('POST', '/api/refunds', {
    body: { customerId: customer.id, creditNoteId: cn.id, amount: 300, method: 'BANK_TRANSFER', reason: 'Customer requested cash' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.refundNumber, 'REF-00001');
  assert.equal(created.json.data.amount, 300);
  assert.equal(created.json.data.creditNote.creditNoteNumber, cn.creditNoteNumber);

  // Nothing left on that credit note to refund.
  const tooMuch = await api('POST', '/api/refunds', {
    body: { customerId: customer.id, creditNoteId: cn.id, amount: 1 },
  });
  assert.equal(tooMuch.status, 400);

  const list = await api('GET', '/api/refunds');
  assert.equal(list.status, 200);
  assert.equal(list.json.meta.totalRefunded, 300);
});

test('a refund against an invoice is capped by the amount received', async () => {
  const cashInvoice = await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      invoiceNumber: 'INV-00003',
      status: 'SENT',
      subtotal: 500,
      total: 500,
      balanceDue: 500,
      items: { create: [{ description: 'Setup', quantity: 1, unitPrice: 500, amount: 500 }] },
    },
  });
  const paid = await api('POST', `/api/invoices/${cashInvoice.id}/payments`, { body: { amount: 500, paymentMethod: 'CASH' } });
  assert.equal(paid.status, 201, JSON.stringify(paid.json));

  const ok = await api('POST', '/api/refunds', { body: { customerId: customer.id, invoiceId: cashInvoice.id, amount: 400 } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.data.amount, 400);

  // Only 100 of the 500 received is still refundable.
  const tooMuch = await api('POST', '/api/refunds', { body: { customerId: customer.id, invoiceId: cashInvoice.id, amount: 200 } });
  assert.equal(tooMuch.status, 400);
});

test('a refund can be voided, and voiding frees the cap again', async () => {
  const refund = await prisma.refund.findFirst({
    where: { tenantId: tenant.id, status: 'COMPLETED', creditNoteId: { not: null } },
  });
  assert.ok(refund, 'a credit-note refund exists to void');

  const voided = await api('POST', `/api/refunds/${refund.id}/void`, { body: { reason: 'wrong amount' } });
  assert.equal(voided.status, 200);
  assert.equal(voided.json.data.status, 'VOID');
  assert.equal(voided.json.data.voidReason, 'wrong amount');

  // The credit that was freed is refundable again.
  const again = await api('POST', '/api/refunds', {
    body: { customerId: customer.id, creditNoteId: refund.creditNoteId, amount: Number(refund.amount) },
  });
  assert.equal(again.status, 201, JSON.stringify(again.json));
});

/* ── invoice void ─────────────────────────────────────────────────── */

test('an invoice with payments cannot be voided', async () => {
  const res = await api('POST', `/api/invoices/${invoice.id}/void`, { body: { reason: 'test' } });
  assert.equal(res.status, 400);
});

test('an untouched invoice can be voided, and a paid one cannot', async () => {
  const fresh = await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      invoiceNumber: 'INV-00002',
      status: 'UNPAID',
      subtotal: 50,
      total: 50,
      balanceDue: 50,
    },
  });

  const voided = await api('POST', `/api/invoices/${fresh.id}/void`, { body: { reason: 'issued in error' } });
  assert.equal(voided.status, 200, JSON.stringify(voided.json));
  assert.equal(voided.json.data.status, 'VOID');
  assert.equal(voided.json.data.voidReason, 'issued in error');

  const again = await api('POST', `/api/invoices/${fresh.id}/void`, { body: {} });
  assert.equal(again.status, 400);
});

/* ── reports ──────────────────────────────────────────────────────── */

test('dashboard cash excludes credit applications and reports refunds', async () => {
  const cash = await prisma.payment.aggregate({
    where: { tenantId: tenant.id, paymentMethod: { not: 'CREDIT_NOTE' } },
    _sum: { amount: true },
  });
  const credit = await prisma.payment.aggregate({
    where: { tenantId: tenant.id, paymentMethod: 'CREDIT_NOTE' },
    _sum: { amount: true },
  });
  assert.ok(Number(credit._sum.amount) > 0, 'the scenario must include applied credit');
  assert.ok(Number(cash._sum.amount) > 0, 'the scenario must include cash');

  const res = await api('GET', '/api/reports/dashboard');
  assert.equal(res.status, 200);
  // Cash received = the cash payments only; applied credit is excluded.
  assert.equal(res.json.data.totalPaid, Number(cash._sum.amount || 0));
  assert.equal(typeof res.json.data.totalRefunded, 'number');
});

test('the payment report splits cash from credit applied', async () => {
  const credit = await prisma.payment.aggregate({
    where: { tenantId: tenant.id, paymentMethod: 'CREDIT_NOTE' },
    _sum: { amount: true },
  });

  const res = await api('GET', '/api/reports/payments');
  assert.equal(res.status, 200);
  assert.equal(res.json.data.summary.totalCreditApplied, Number(credit._sum.amount || 0));
  assert.ok(res.json.data.summary.totalReceived > 0, 'cash received is reported');
  assert.ok(res.json.data.byMethod.some((m) => m.method === 'CREDIT_NOTE'));
});

/* ── tenant isolation ─────────────────────────────────────────────── */

test('credit notes and refunds never cross tenant boundaries', async () => {
  const other = await prisma.tenant.create({ data: { name: 'Other Credits', slug: 'credits-other' } });
  try {
    const foreign = await prisma.creditNote.create({
      data: {
        tenantId: other.id,
        customerId: customer.id,
        creditNoteNumber: 'CN-FOREIGN',
        total: 100,
        items: { create: [{ description: 'x', quantity: 1, unitPrice: 100, amount: 100 }] },
      },
    });

    const get = await api('GET', `/api/credit-notes/${foreign.id}`);
    assert.equal(get.status, 404);

    const list = await api('GET', '/api/credit-notes');
    assert.ok(!list.json.data.some((c) => c.id === foreign.id), 'the foreign credit note is not listed');

    const apply = await api('POST', `/api/credit-notes/${foreign.id}/apply`, { body: {} });
    assert.equal(apply.status, 404);
  } finally {
    await prisma.creditNote.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.deleteMany({ where: { slug: 'credits-other' } });
  }
});
