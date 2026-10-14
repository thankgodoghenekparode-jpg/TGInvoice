/**
 * Outbound messaging: WhatsApp Cloud API + SMS (+ email) with a delivery log.
 *
 * Providers are env-gated and fail soft: an unconfigured provider records a
 * SKIPPED log row instead of throwing, and a configured provider posts the
 * real document PDF into the WhatsApp chat.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import config from '../src/config.js';
import app from '../src/app.js';
import { deliver, normalizePhone, messagingStatus, isWhatsAppConfigured } from '../src/services/messagingService.js';

let server;
let base;
let tenant;
let token;
let customer;
let invoice;

const realFetch = globalThis.fetch;

function clearProviders() {
  config.whatsapp.token = '';
  config.whatsapp.phoneNumberId = '';
  config.sms.provider = '';
  config.sms.apiKey = '';
  config.sms.accountSid = '';
  config.sms.authToken = '';
  config.sms.from = '';
}

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
  clearProviders();

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const user = await prisma.user.create({
    data: { name: 'Messaging Owner', email: 'messaging@test.local', passwordHash, emailVerified: true },
  });
  tenant = await prisma.tenant.create({ data: { name: 'Messaging Co', slug: 'messaging-tenant' } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.companySettings.create({ data: { tenantId: tenant.id, businessName: 'Messaging Co', currency: 'NGN', currencySymbol: '₦' } });
  for (const [kind, prefix] of [['CUSTOMER', 'CUS'], ['QUOTATION', 'QT'], ['INVOICE', 'INV'], ['RECEIPT', 'REC']]) {
    await prisma.documentSequence.create({ data: { tenantId: tenant.id, kind, prefix, next: 1 } });
  }
  customer = await prisma.customer.create({
    data: { tenantId: tenant.id, customerCode: 'CUS-00001', name: 'Ada Obi', email: 'ada@example.com', phone: '08031234567' },
  });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'messaging@test.local', password: 'ChangeMe123!' }),
  });
  const loginJson = await login.json();
  assert.equal(login.status, 200, 'login must succeed');
  token = loginJson.data.accessToken;

  const created = await api('POST', '/api/invoices', {
    body: {
      customerId: customer.id,
      invoiceDate: new Date().toISOString().slice(0, 10),
      items: [{ description: 'Consulting', quantity: 1, unitPrice: 150000 }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  invoice = created.json.data;
});

after(async () => {
  globalThis.fetch = realFetch;
  clearProviders();
  await prisma.messageLog.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.membership.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.deleteMany({ where: { slug: 'messaging-tenant' } });
  await prisma.user.deleteMany({ where: { email: 'messaging@test.local' } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(clearProviders);
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('phone numbers are normalised to international digits', () => {
  assert.equal(normalizePhone('08031234567'), '2348031234567', 'local 0… → country code');
  assert.equal(normalizePhone('+234 803 123 4567'), '2348031234567', 'spaces and + are stripped');
  assert.equal(normalizePhone('2348031234567'), '2348031234567', 'already international is unchanged');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('123'), null, 'too short to be a phone number');
});

test('an unconfigured channel records SKIPPED instead of throwing', async () => {
  const before = await prisma.messageLog.count({ where: { tenantId: tenant.id } });

  const result = await deliver({ tenantId: tenant.id, channel: 'WHATSAPP', to: customer.phone, text: 'Hello' });

  assert.equal(result.sent, false);
  assert.equal(result.status, 'SKIPPED');
  assert.equal(isWhatsAppConfigured(), false);

  const logs = await prisma.messageLog.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(logs.length, before + 1, 'the attempt is always logged');
  assert.equal(logs[0].status, 'SKIPPED');
  assert.equal(logs[0].channel, 'WHATSAPP');
  assert.equal(logs[0].to, customer.phone);
});

test('WhatsApp sends the document itself, by public link, once configured', async () => {
  config.whatsapp.token = 'test-token';
  config.whatsapp.phoneNumberId = '123456';
  assert.equal(isWhatsAppConfigured(), true);

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.TEST123' }] }) };
  };

  const result = await deliver({
    tenantId: tenant.id,
    channel: 'WHATSAPP',
    to: '08031234567',
    text: 'Please find your invoice INV-00001.',
    documentLink: 'https://api.example.com/api/public/documents/token',
    fileName: 'INV-00001',
    documentKind: 'INVOICE',
    documentId: invoice.id,
    customerId: customer.id,
  });

  assert.equal(result.sent, true);
  assert.equal(result.providerMessageId, 'wamid.TEST123');

  assert.equal(calls.length, 1, 'exactly one Cloud API call');
  assert.match(calls[0].url, /graph\.facebook\.com\/v21\.0\/123456\/messages/);
  assert.equal(calls[0].auth, 'Bearer test-token');
  assert.equal(calls[0].body.type, 'document', 'the PDF is delivered as a WhatsApp document');
  assert.equal(calls[0].body.to, '2348031234567', 'the number is upgraded to E.164');
  assert.equal(calls[0].body.document.link, 'https://api.example.com/api/public/documents/token');
  assert.equal(calls[0].body.document.filename, 'INV-00001.pdf');

  const log = await prisma.messageLog.findFirst({ where: { tenantId: tenant.id, providerMessageId: 'wamid.TEST123' } });
  assert.ok(log);
  assert.equal(log.status, 'SENT');
  assert.equal(log.documentKind, 'INVOICE');
  assert.equal(log.documentId, invoice.id);
});

test('SMS uses the configured provider (Termii) and logs the message id', async () => {
  config.sms.provider = 'termii';
  config.sms.apiKey = 'termii-key';
  config.sms.senderId = 'tgeasy';

  globalThis.fetch = async (url) => {
    assert.match(url, /api\.ng\.termii\.com/);
    return { ok: true, status: 200, text: async () => JSON.stringify({ message_id: 'sms-abc' }) };
  };

  const result = await deliver({ tenantId: tenant.id, channel: 'SMS', to: customer.phone, text: 'Your invoice is due tomorrow.' });
  assert.equal(result.sent, true);
  assert.equal(result.providerMessageId, 'sms-abc');
  assert.equal(result.status, 'SENT');
});

test('a provider error is recorded as FAILED with the reason', async () => {
  config.whatsapp.token = 'test-token';
  config.whatsapp.phoneNumberId = '123456';

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Recipient phone number not in allowed list' } }),
  });

  const result = await deliver({ tenantId: tenant.id, channel: 'WHATSAPP', to: customer.phone, text: 'Hello' });
  assert.equal(result.sent, false);
  assert.equal(result.status, 'FAILED');

  const log = await prisma.messageLog.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(log.status, 'FAILED');
  assert.match(log.error, /allowed list/);
});

test('GET /api/messages/status reports which providers are configured', async () => {
  const res = await api('GET', '/api/messages/status');
  assert.equal(res.status, 200);
  assert.equal(res.json.data.whatsapp, false);
  assert.equal(res.json.data.sms, false);
  assert.equal(typeof res.json.data.email, 'boolean');
});

test('POST /api/invoices/:id/deliver reports per-channel results and logs them', async () => {
  const res = await api('POST', `/api/invoices/${invoice.id}/deliver`, { body: { channels: ['SMS'] } });
  assert.equal(res.status, 200, JSON.stringify(res.json));

  const results = res.json.data.results;
  assert.equal(results.length, 1);
  assert.equal(results[0].channel, 'SMS');
  assert.equal(results[0].status, 'SKIPPED', 'SMS is not configured in this environment');
  assert.ok(res.json.data.previewUrl, 'the public document link is returned');

  const log = await prisma.messageLog.findFirst({ where: { tenantId: tenant.id, channel: 'SMS' }, orderBy: { createdAt: 'desc' } });
  assert.ok(log);

  const list = await api('GET', '/api/messages?channel=SMS');
  assert.equal(list.status, 200);
  assert.ok(list.json.data.some((row) => row.channel === 'SMS'));
});

test('delivery requires at least one channel', async () => {
  const res = await api('POST', `/api/invoices/${invoice.id}/deliver`, { body: { channels: [] } });
  assert.equal(res.status, 400);
});

test('marking an invoice sent is unaffected when no auto-delivery is configured', async () => {
  const res = await api('POST', `/api/invoices/${invoice.id}/send`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.status, 'SENT');
  // The auto-delivery job is queued but does nothing without configured channels.
  const jobs = await prisma.job.findMany({ where: { type: 'document.autoDeliver' } });
  assert.ok(jobs.length >= 1, 'an auto-delivery job is enqueued for the worker');
  await prisma.job.deleteMany({ where: { type: 'document.autoDeliver' } });
});

test('messagingStatus reflects the flipped config', () => {
  config.sms.provider = 'twilio';
  config.sms.accountSid = 'AC123';
  config.sms.authToken = 'tok';
  config.sms.from = '+15550000000';
  const status = messagingStatus();
  assert.equal(status.sms, true);
  assert.equal(status.smsProvider, 'twilio');
});
