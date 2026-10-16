/**
 * Online payments — hosted checkout (Paystack/Flutterwave) + settlement.
 *
 * What must hold:
 *   - with no gateway configured the app still runs and says so clearly;
 *   - a link charges the outstanding balance and prices in the right unit
 *     (Paystack kobo, not naira);
 *   - only the owning business can see/verify/cancel its own links;
 *   - a webhook with a bad signature never touches money;
 *   - a valid webhook records exactly one Payment + Receipt, flips the
 *     invoice to PAID, and replays are idempotent;
 *   - underpayment is refused rather than recorded as payment in full;
 *   - unknown references are acknowledged without side effects;
 *   - the return-from-checkout verify path settles too;
 *   - reconciliation catches a paid checkout whose webhook never arrived.
 *
 * The gateway HTTP layer is stubbed through `transport.request` — nothing here
 * reaches the internet, and signatures are computed exactly as Paystack does.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import app from '../src/app.js';
import config from '../src/config.js';
import { transport } from '../src/services/paymentGateway.js';
import { reconcileStaleIntents } from '../src/services/paymentService.js';

const PAYSTACK_SECRET = 'sk_test_paystack_key';
const WEBHOOK_SECRET = 'whsec_payments_test';

let server;
let base;

let tenantA;
let tenantB;
let ownerToken;
let otherOwnerToken;
let staffToken;

/** Gateway call log + the amount (in kobo) verify should report per reference. */
const gatewayCalls = [];
const paidKobo = new Map();

const FIXED_EMAILS = ['pay-owner@test.local', 'pay-staff@test.local', 'pay-other@test.local'];
const TENANT_SLUGS = ['payments-co-a', 'payments-co-b'];

const sign = (raw) => crypto.createHmac('sha512', WEBHOOK_SECRET).update(raw).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

async function api(method, path, { body, token = ownerToken, tenant = tenantA.id } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenant },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

/** Deliver a Paystack webhook signed over the exact bytes sent. */
async function webhook(payload) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${base}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sign(raw) },
    body: raw,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function webhookWithSignature(raw, signature) {
  const res = await fetch(`${base}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
    body: raw,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function createInvoice(tenantId, token, amount, customerName = 'Pay Customer') {
  const customer = await api('POST', '/api/customers', { body: { name: customerName }, token, tenant: tenantId });
  assert.equal(customer.status, 201, JSON.stringify(customer.json));

  const invoice = await api('POST', '/api/invoices', {
    body: {
      customerId: customer.json.data.id,
      invoiceDate: today(),
      items: [{ description: 'Consulting', quantity: 1, unitPrice: amount }],
    },
    token,
    tenant: tenantId,
  });
  assert.equal(invoice.status, 201, JSON.stringify(invoice.json));
  return invoice.json.data;
}

/** Stub the gateway. Create → a checkout URL; verify → a configurable answer. */
function stubGateway() {
  transport.request = async ({ url, method = 'GET', body }) => {
    gatewayCalls.push({ url, method, body });
    if (url.includes('/transaction/initialize')) {
      return {
        status: true,
        message: 'Authorization URL created',
        data: { authorization_url: `https://checkout.paystack.com/${gatewayCalls.length}`, access_code: `acc_${gatewayCalls.length}` },
      };
    }
    if (url.includes('/transaction/verify/')) {
      const reference = decodeURIComponent(url.split('/transaction/verify/')[1]);
      return {
        status: true,
        data: {
          status: 'success',
          amount: paidKobo.get(reference) ?? 0,
          currency: 'NGN',
          paid_at: new Date().toISOString(),
          transaction_id: 991122,
          reference,
        },
      };
    }
    throw new Error(`unexpected gateway call: ${url}`);
  };
}

/** Open a checkout link for an invoice and return the serialized intent. */
async function openLink(invoice, { amount } = {}) {
  const res = await api('POST', `/api/invoices/${invoice.id}/payment-link`, { body: amount ? { amount } : {} });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.data;
}

async function cleanup() {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: TENANT_SLUGS } }, select: { id: true } });
  const ids = tenants.map((t) => t.id);
  if (ids.length) {
    await prisma.paymentIntent.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { in: FIXED_EMAILS } } });
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    await cleanup();
  } catch (err) {
    console.error('[payments.test] pre-clean failed', err.message);
  }

  // Paystack is the active gateway for this suite (runtime mutation: config is
  // read at call time, and ESM imports hoist above process.env assignments).
  config.payments.provider = 'paystack';
  config.payments.paystackSecretKey = PAYSTACK_SECRET;
  config.payments.secretKey = '';
  config.payments.webhookSecret = WEBHOOK_SECRET;
  config.payments.callbackUrl = '';
  stubGateway();

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);

  tenantA = await prisma.tenant.create({ data: { name: 'Payments Co A', slug: 'payments-co-a' } });
  tenantB = await prisma.tenant.create({ data: { name: 'Payments Co B', slug: 'payments-co-b' } });

  const mkUser = async (name, email, tenantId, role) => {
    const user = await prisma.user.create({ data: { name, email, passwordHash, emailVerified: true } });
    await prisma.membership.create({ data: { userId: user.id, tenantId, role, status: 'ACTIVE' } });
    return user;
  };

  await mkUser('Pay Ownerson', 'pay-owner@test.local', tenantA.id, 'OWNER');
  await mkUser('Pay Staff', 'pay-staff@test.local', tenantA.id, 'STAFF');
  await mkUser('Other Owner', 'pay-other@test.local', tenantB.id, 'OWNER');

  const login = async (email) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'ChangeMe123!' }),
    });
    const json = await res.json();
    assert.equal(res.status, 200, `login for ${email}: ${JSON.stringify(json)}`);
    return json.data.accessToken;
  };

  ownerToken = await login('pay-owner@test.local');
  staffToken = await login('pay-staff@test.local');
  otherOwnerToken = await login('pay-other@test.local');
});

after(async () => {
  try {
    await cleanup();
    await prisma.$disconnect();
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

/* ── configuration ────────────────────────────────────────────────── */

test('without a configured gateway the app still runs and explains why', async () => {
  const invoice = await createInvoice(tenantA.id, ownerToken, 12000, 'Unconfigured Customer');

  const saved = { ...config.payments };
  config.payments.provider = '';
  config.payments.secretKey = '';
  config.payments.paystackSecretKey = '';

  const res = await api('POST', `/api/invoices/${invoice.id}/payment-link`, { body: {} });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error.message, /not enabled/i);

  Object.assign(config.payments, saved);
});

/* ── creating a link ──────────────────────────────────────────────── */

test('creating a link returns a hosted checkout priced in the gateway unit', async () => {
  const invoice = await createInvoice(tenantA.id, ownerToken, 25000, 'Checkout Customer');
  assert.equal(Number(invoice.balanceDue), 25000);

  gatewayCalls.length = 0;
  const intent = await openLink(invoice);

  assert.equal(intent.status, 'PENDING');
  assert.equal(intent.provider, 'paystack');
  assert.equal(intent.amount, 25000, 'the full outstanding balance is charged');
  assert.equal(intent.currency, 'NGN');
  assert.match(intent.checkoutUrl, /^https:\/\/checkout\.paystack\.com\//);
  assert.match(intent.reference, /^tgx_[a-f0-9]{24}$/);

  const init = gatewayCalls.find((c) => c.url.includes('/transaction/initialize'));
  assert.ok(init, 'the gateway was asked to initialize a transaction');
  assert.equal(init.body.amount, 2_500_000, 'Paystack receives minor units (kobo)');
  assert.equal(init.body.currency, 'NGN');
  assert.equal(init.body.reference, intent.reference);

  // Shared for the settlement tests below.
  globalThis.__linkA = intent;
  globalThis.__invoiceA = invoice;
});

test('staff can raise a payment link, exactly like recording a payment', async () => {
  const invoice = await createInvoice(tenantA.id, staffToken, 3000, 'Staff Customer');
  const res = await api('POST', `/api/invoices/${invoice.id}/payment-link`, { body: {}, token: staffToken });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.status, 'PENDING');
});

test('the link is listed against its invoice', async () => {
  const res = await api('GET', `/api/invoices/${globalThis.__invoiceA.id}/payment-links`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.ok(res.json.data.some((i) => i.reference === globalThis.__linkA.reference));
});

/* ── isolation ────────────────────────────────────────────────────── */

test('another business can neither list nor verify the link', async () => {
  const list = await api('GET', `/api/invoices/${globalThis.__invoiceA.id}/payment-links`, {
    token: otherOwnerToken,
    tenant: tenantB.id,
  });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.data, [], 'another tenant sees no intents on that invoice');

  const verify = await api('POST', `/api/invoices/${globalThis.__invoiceA.id}/payment-links/${globalThis.__linkA.id}/verify`, {
    token: otherOwnerToken,
    tenant: tenantB.id,
  });
  assert.equal(verify.status, 404, JSON.stringify(verify.json));
});

/* ── webhooks ─────────────────────────────────────────────────────── */

test('a webhook with a bad signature is rejected and records nothing', async () => {
  const invoice = globalThis.__invoiceA;
  const payload = {
    event: 'charge.success',
    data: { reference: globalThis.__linkA.reference, amount: 2_500_000, currency: 'NGN', transaction_id: 4242 },
  };

  const res = await webhookWithSignature(JSON.stringify(payload), 'not-the-right-signature');
  assert.equal(res.status, 401, JSON.stringify(res.json));

  const payments = await prisma.payment.count({ where: { invoiceId: invoice.id } });
  assert.equal(payments, 0, 'no money was recorded');
  const intent = await prisma.paymentIntent.findUnique({ where: { reference: globalThis.__linkA.reference } });
  assert.equal(intent.status, 'PENDING');
});

test('a valid webhook records one payment + receipt and settles the invoice', async () => {
  const invoice = globalThis.__invoiceA;
  const intent = globalThis.__linkA;

  const res = await webhook({
    event: 'charge.success',
    data: {
      reference: intent.reference,
      amount: 2_500_000,
      currency: 'NGN',
      paid_at: new Date().toISOString(),
      transaction_id: 987654,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.status, 'settled');

  const fresh = await prisma.paymentIntent.findUnique({ where: { reference: intent.reference } });
  assert.equal(fresh.status, 'SUCCEEDED');
  assert.equal(fresh.providerRef, '987654');
  assert.ok(fresh.paidAt, 'paidAt is stamped');

  const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
  assert.equal(payments.length, 1);
  assert.equal(Number(payments[0].amount), 25000);
  assert.equal(payments[0].paymentMethod, 'ONLINE');
  assert.equal(payments[0].reference, intent.reference);
  assert.equal(payments[0].tenantId, invoice.tenantId, 'the payment belongs to the invoice tenant');

  const receipt = await prisma.receipt.findFirst({ where: { paymentId: payments[0].id } });
  assert.ok(receipt, 'a receipt is issued automatically');
  assert.equal(Number(receipt.amount), 25000);

  const settled = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(Number(settled.amountPaid), 25000);
  assert.equal(Number(settled.balanceDue), 0);
  assert.equal(settled.status, 'PAID');
});

test('replaying the webhook never double-records money', async () => {
  const invoice = globalThis.__invoiceA;
  const intent = globalThis.__linkA;

  const replay = () =>
    webhook({
      event: 'charge.success',
      data: { reference: intent.reference, amount: 2_500_000, currency: 'NGN', transaction_id: 987654 },
    });

  const first = await replay();
  const second = await replay();
  assert.equal(first.json.status, 'already_settled');
  assert.equal(second.json.status, 'already_settled');

  const payments = await prisma.payment.count({ where: { invoiceId: invoice.id } });
  assert.equal(payments, 1, 'still exactly one payment');

  const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(Number(fresh.amountPaid), 25000);
});

test('an underpayment is refused, not recorded as payment in full', async () => {
  const invoice = await createInvoice(tenantA.id, ownerToken, 5000, 'Short Pay Customer');
  const intent = await openLink(invoice);

  const res = await webhook({
    event: 'charge.success',
    data: { reference: intent.reference, amount: 100_000, currency: 'NGN', transaction_id: 111 }, // ₦1,000
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.status, 'amount_mismatch');

  const fresh = await prisma.paymentIntent.findUnique({ where: { reference: intent.reference } });
  assert.equal(fresh.status, 'FAILED');
  assert.equal(fresh.metadata.mismatch.charged, 1000);

  const payments = await prisma.payment.count({ where: { invoiceId: invoice.id } });
  assert.equal(payments, 0, 'nothing was written against the invoice');
  const untouched = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(Number(untouched.balanceDue), 5000);
});

test('an unknown reference is acknowledged without side effects', async () => {
  const ghost = `tgx_${'0'.repeat(24)}`;
  const res = await webhook({
    event: 'charge.success',
    data: { reference: ghost, amount: 500_000, currency: 'NGN', transaction_id: 222 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.status, 'unknown_reference');
  assert.equal(await prisma.paymentIntent.count({ where: { reference: ghost } }), 0);
});

test('a failed charge marks the link failed instead of settling it', async () => {
  const invoice = await createInvoice(tenantA.id, ownerToken, 4000, 'Declined Customer');
  const intent = await openLink(invoice);

  const res = await webhook({
    event: 'charge.failed',
    data: { reference: intent.reference, amount: 400_000, currency: 'NGN', status: 'failed' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.status, 'failed');

  const fresh = await prisma.paymentIntent.findUnique({ where: { reference: intent.reference } });
  assert.equal(fresh.status, 'FAILED');
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 0);
});

/* ── return from checkout + reconciliation ────────────────────────── */

test('the verify endpoint confirms a payment directly with the gateway', async () => {
  const invoice = await createInvoice(tenantA.id, ownerToken, 3000, 'Verify Customer');
  const intent = await openLink(invoice);
  paidKobo.set(intent.reference, 300_000);

  const res = await api('POST', `/api/invoices/${invoice.id}/payment-links/${intent.id}/verify`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.meta.verification.paid, true);
  assert.equal(res.json.data.status, 'SUCCEEDED');

  const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(fresh.status, 'PAID');
  assert.equal(Number(fresh.balanceDue), 0);
});

test('reconciliation settles a paid checkout whose webhook never arrived', async () => {
  const invoice = await createInvoice(tenantA.id, ownerToken, 7000, 'Reconcile Customer');
  const intent = await openLink(invoice);
  paidKobo.set(intent.reference, 700_000);

  // Age the intent so the hourly sweep considers it stale.
  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });

  const report = await reconcileStaleIntents({ olderThanMinutes: 60 });
  assert.ok(report.scanned >= 1, 'the stale intent was picked up');
  assert.ok(report.settled >= 1, 'and settled via the gateway API');

  const fresh = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
  assert.equal(fresh.status, 'SUCCEEDED');
  const paidInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(paidInvoice.status, 'PAID');
});

test('cancelling a pending link stops it', async () => {
  const invoice = await createInvoice(tenantA.id, ownerToken, 2000, 'Cancel Customer');
  const intent = await openLink(invoice);

  const res = await api('POST', `/api/invoices/${invoice.id}/payment-links/${intent.id}/cancel`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.status, 'ABANDONED');

  // A late webhook for a cancelled link must not record money.
  const late = await webhook({
    event: 'charge.success',
    data: { reference: intent.reference, amount: 200_000, currency: 'NGN', transaction_id: 333 },
  });
  assert.equal(late.json.status, 'intent_closed');
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 0);
});
