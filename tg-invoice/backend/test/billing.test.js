/**
 * Recurring invoices + automated payment reminders (dunning).
 *
 * Both features run from the worker, so the tests drive the services directly.
 * The invariants that matter:
 *   - a due recurring template raises exactly one invoice, then advances its
 *     schedule (so a second tick — or a second worker — cannot double-bill);
 *   - a dunning rule chases each invoice at most once, whatever the offset.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import config from '../src/config.js';
import app from '../src/app.js';
import { runDueRecurringInvoices, addInterval } from '../src/services/recurringService.js';
import { runDueReminders, previewReminders, buildReminderMessage } from '../src/services/reminderService.js';

let server;
let base;
let tenant;
let token;
let customer;
let recId;

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

const realFetch = globalThis.fetch;
let sentCalls = [];

/** Let test HTTP through to the app; capture stubbed outbound provider calls. */
function stubProviders() {
  sentCalls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return realFetch(url, init);
    const body = init?.body ? String(init.body) : '';
    sentCalls.push({ url: String(url), body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ message_id: `msg-${sentCalls.length}` }) };
  };
}

function configureSms() {
  config.sms.provider = 'termii';
  config.sms.apiKey = 'test-key';
  config.sms.senderId = 'tgeasy';
}

function clearSms() {
  config.sms.provider = '';
  config.sms.apiKey = '';
  config.sms.senderId = '';
}

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
    /* non-JSON */
  }
  return { status: res.status, json };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  configureSms();
  stubProviders();

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const user = await prisma.user.create({
    data: { name: 'Billing Owner', email: 'billing@test.local', passwordHash, emailVerified: true },
  });
  tenant = await prisma.tenant.create({ data: { name: 'Billing Co', slug: 'billing-tenant' } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.companySettings.create({
    data: { tenantId: tenant.id, businessName: 'Billing Co', currency: 'NGN', currencySymbol: '₦' },
  });
  for (const [kind, prefix] of [['CUSTOMER', 'CUS'], ['INVOICE', 'INV']]) {
    await prisma.documentSequence.create({ data: { tenantId: tenant.id, kind, prefix, next: 1 } });
  }
  customer = await prisma.customer.create({
    data: { tenantId: tenant.id, customerCode: 'CUS-00001', name: 'Ada Obi', email: 'ada@example.com', phone: '08031234567' },
  });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'billing@test.local', password: 'ChangeMe123!' }),
  });
  const loginJson = await login.json();
  assert.equal(login.status, 200, 'login must succeed');
  token = loginJson.data.accessToken;
});

after(async () => {
  globalThis.fetch = realFetch;
  clearSms();
  await prisma.reminderSent.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.reminderRule.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.recurringInvoice.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.invoice.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.customer.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.documentSequence.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.companySettings.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.membership.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.deleteMany({ where: { slug: 'billing-tenant' } });
  await prisma.user.deleteMany({ where: { email: 'billing@test.local' } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

/* ── pure helpers ─────────────────────────────────────────────────── */

test('addInterval advances by the right unit', () => {
  const base = new Date('2026-01-15T00:00:00Z');
  assert.equal(addInterval(base, 'WEEKLY', 2).getUTCDate(), 29);
  assert.equal(addInterval(base, 'MONTHLY', 1).getUTCMonth(), 1 /* February */);
  assert.equal(addInterval(base, 'QUARTERLY', 1).getUTCMonth(), 3 /* April */);
  assert.equal(addInterval(base, 'SEMIANNUAL', 1).getUTCMonth(), 6 /* July */);
  assert.equal(addInterval(base, 'ANNUAL', 1).getUTCFullYear(), 2027);
  assert.equal(addInterval(base, 'MONTHLY', 0).getUTCMonth(), 1, 'interval is floored at 1');
});

test('reminder templates fill placeholders and fall back to a sensible default', () => {
  const invoice = { invoiceNumber: 'INV-00007', balanceDue: 25000, total: 50000, dueDate: daysFromNow(-2) };
  const settings = { businessName: 'Billing Co', currency: 'NGN', currencySymbol: '₦' };

  const custom = buildReminderMessage(
    { subject: 'Overdue: {number}', bodyTemplate: 'Hi {customer}, {amount} is due on {dueDate}.' },
    { invoice, customer: { name: 'Ada' }, settings }
  );
  assert.equal(custom.subject, 'Overdue: INV-00007');
  assert.match(custom.body, /Hi Ada, ₦25,000\.00 is due/);

  const fallback = buildReminderMessage({}, { invoice, customer: { name: 'Ada' }, settings });
  assert.match(fallback.subject, /INV-00007/);
  assert.match(fallback.body, /outstanding balance of ₦25,000\.00/);
});

/* ── recurring invoices ───────────────────────────────────────────── */

test('a recurring invoice template can be created and listed', async () => {
  const res = await api('POST', '/api/recurring-invoices', {
    body: {
      customerId: customer.id,
      name: 'Monthly retainer',
      frequency: 'MONTHLY',
      interval: 1,
      nextRunAt: new Date(Date.now() - 60_000).toISOString(), // already due
      dueInDays: 14,
      autoSend: false,
      items: [{ description: 'Retainer', quantity: 2, unitPrice: 50000 }],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.data.estimatedTotal), 100000);
  recId = res.json.data.id;

  const list = await api('GET', '/api/recurring-invoices?search=retainer');
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 1);
  assert.equal(list.json.meta.total, 1);
});

test('a due template raises exactly one invoice and advances its schedule', async () => {
  const report = await runDueRecurringInvoices();
  assert.ok(report.count >= 1, 'the due template generated an invoice');

  const generated = await prisma.invoice.findMany({ where: { recurringInvoiceId: recId } });
  assert.equal(generated.length, 1);
  assert.equal(generated[0].status, 'UNPAID');
  assert.ok(generated[0].invoiceNumber, 'a number was allocated');
  assert.equal(Number(generated[0].total), 100000);
  assert.equal(Number(generated[0].balanceDue), 100000);

  const rec = await prisma.recurringInvoice.findUnique({ where: { id: recId } });
  assert.equal(rec.generatedCount, 1);
  assert.ok(rec.lastRunAt, 'lastRunAt was stamped');
  assert.ok(rec.nextRunAt.getTime() > Date.now(), 'the schedule moved into the future');

  // A second tick must not double-bill.
  await runDueRecurringInvoices();
  const after = await prisma.invoice.count({ where: { recurringInvoiceId: recId } });
  assert.equal(after, 1, 'no duplicate invoice on the next scan');
});

test('run-now raises an invoice on demand and advances the schedule again', async () => {
  const before = await prisma.recurringInvoice.findUnique({ where: { id: recId } });

  const res = await api('POST', `/api/recurring-invoices/${recId}/run`);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.invoice.total, 100000);

  const count = await prisma.invoice.count({ where: { recurringInvoiceId: recId } });
  assert.equal(count, 2);

  const rec = await prisma.recurringInvoice.findUnique({ where: { id: recId } });
  assert.equal(rec.generatedCount, 2);
  assert.ok(rec.nextRunAt.getTime() > before.nextRunAt.getTime(), 'advanced one more period');
});

test('a paused template is skipped by the due scan', async () => {
  const paused = await api('PATCH', `/api/recurring-invoices/${recId}/status`, { body: { status: 'PAUSED' } });
  assert.equal(paused.status, 200);
  assert.equal(paused.json.data.status, 'PAUSED');

  // Make it due again to prove the scan respects the status, not just the clock.
  await prisma.recurringInvoice.update({ where: { id: recId }, data: { nextRunAt: daysFromNow(-1) } });
  await runDueRecurringInvoices();

  const count = await prisma.invoice.count({ where: { recurringInvoiceId: recId } });
  assert.equal(count, 2, 'nothing generated while paused');
});

test('deleting a template removes the schedule but keeps the invoices it raised', async () => {
  const del = await api('DELETE', `/api/recurring-invoices/${recId}`);
  assert.equal(del.status, 200);

  const gone = await api('GET', `/api/recurring-invoices/${recId}`);
  assert.equal(gone.status, 404);

  const orphans = await prisma.invoice.findMany({ where: { recurringInvoiceId: null, tenantId: tenant.id } });
  assert.ok(orphans.length >= 2, 'generated invoices survive with a null link');
});

test('recurring invoices are tenant-scoped', async () => {
  const otherTenant = await prisma.tenant.create({ data: { name: 'Other Co', slug: 'billing-other' } });
  try {
    const created = await prisma.recurringInvoice.create({
      data: { tenantId: otherTenant.id, customerId: customer.id, name: 'Foreign', nextRunAt: new Date() },
    });
    // Same headers (our tenant); the foreign id must look like it does not exist.
    const res = await api('GET', `/api/recurring-invoices/${created.id}`);
    assert.equal(res.status, 404);
  } finally {
    await prisma.recurringInvoice.deleteMany({ where: { tenantId: otherTenant.id } });
    await prisma.tenant.deleteMany({ where: { slug: 'billing-other' } });
  }
});

/* ── reminders / dunning ──────────────────────────────────────────── */

async function makeInvoice(number, { dueDate, balanceDue = 1000 }) {
  return prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      invoiceNumber: number,
      invoiceDate: daysFromNow(-30),
      dueDate,
      status: 'UNPAID',
      subtotal: balanceDue,
      total: balanceDue,
      balanceDue,
    },
  });
}

test('a rule can be created; preview lists what it would chase', async () => {
  const overdue = await makeInvoice('INV-REM-OVERDUE', { dueDate: daysFromNow(-10) });

  const res = await api('POST', '/api/reminder-rules', {
    body: { name: 'Chase after 3 days', stage: 'AFTER_DUE', offsetDays: 3, channels: ['SMS'] },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const ruleId = res.json.data.id;

  const preview = await api('GET', '/api/reminder-rules/preview');
  assert.equal(preview.status, 200);
  const row = preview.json.data.find((r) => r.ruleId === ruleId);
  assert.ok(row, 'the rule appears in the preview');
  assert.ok(row.dueCount >= 1);
  assert.ok(row.sample.some((s) => s.id === overdue.id), 'the overdue invoice is queued');
});

test('an overdue invoice is chased once, then never again', async () => {
  const rule = await prisma.reminderRule.findFirst({ where: { tenantId: tenant.id, offsetDays: 3 } });
  const overdue = await prisma.invoice.findFirst({ where: { tenantId: tenant.id, invoiceNumber: 'INV-REM-OVERDUE' } });

  const first = await runDueReminders({ tenantId: tenant.id });
  assert.ok(first.sent >= 1, 'the reminder was delivered');
  assert.equal(first.failed, 0, 'no delivery failures');
  assert.ok(
    sentCalls.some((c) => c.body.includes('INV-REM-OVERDUE')),
    'the SMS body names the invoice'
  );

  const records = await prisma.reminderSent.findMany({ where: { ruleId: rule.id, invoiceId: overdue.id } });
  assert.equal(records.length, 1, 'the pair is recorded exactly once');
  assert.equal(records[0].stage, 'AFTER_DUE');

  const second = await runDueReminders({ tenantId: tenant.id });
  const again = await prisma.reminderSent.count({ where: { ruleId: rule.id, invoiceId: overdue.id } });
  assert.equal(again, 1, 're-running does not chase the same invoice twice');
  assert.equal(second.sent + second.skipped, 0, 'nothing new to send');
});

test('a before-due rule only fires inside its window', async () => {
  const soon = await makeInvoice('INV-REM-SOON', { dueDate: daysFromNow(2) });
  const far = await makeInvoice('INV-REM-FAR', { dueDate: daysFromNow(20) });

  const res = await api('POST', '/api/reminder-rules', {
    body: { name: 'Heads-up 3 days before', stage: 'BEFORE_DUE', offsetDays: -3, channels: ['SMS'] },
  });
  assert.equal(res.status, 201);
  const ruleId = res.json.data.id;

  await runDueReminders({ tenantId: tenant.id });

  const soonHit = await prisma.reminderSent.count({ where: { ruleId, invoiceId: soon.id } });
  const farHit = await prisma.reminderSent.count({ where: { ruleId, invoiceId: far.id } });
  assert.equal(soonHit, 1, 'due within the window → reminded');
  assert.equal(farHit, 0, 'due well outside the window → left alone');
});

test('the payment status endpoint reports configured channels for reminders', async () => {
  const res = await api('GET', '/api/messages/status');
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.data.email, 'boolean');
  assert.equal(typeof res.json.data.whatsapp, 'boolean');
});

test('reminder rules are tenant-scoped', async () => {
  const other = await prisma.tenant.create({ data: { name: 'Other Reminders', slug: 'billing-rem-other' } });
  try {
    const foreign = await prisma.reminderRule.create({
      data: { tenantId: other.id, name: 'Foreign rule', channels: ['EMAIL'] },
    });
    const res = await api('PUT', `/api/reminder-rules/${foreign.id}`, {
      body: { name: 'Hijacked', stage: 'ON_DUE', offsetDays: 0, channels: ['EMAIL'] },
    });
    assert.equal(res.status, 404);

    const untouched = await prisma.reminderRule.findUnique({ where: { id: foreign.id } });
    assert.equal(untouched.name, 'Foreign rule');
  } finally {
    await prisma.reminderRule.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.deleteMany({ where: { slug: 'billing-rem-other' } });
  }
});

test('previewReminders returns a row per rule', async () => {
  const rows = await previewReminders(tenant.id);
  const rules = await prisma.reminderRule.count({ where: { tenantId: tenant.id } });
  assert.equal(rows.length, rules);
});
