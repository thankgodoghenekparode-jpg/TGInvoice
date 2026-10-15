/**
 * Referral + partner (reseller/accountant/affiliate) program.
 *
 * What must hold:
 *   - a business can only create codes and read its own programme (owner/admin);
 *   - signup with a code attributes the referral once, increments uses,
 *     respects maxUses, and never blocks signup;
 *   - a referral qualifies only when the referred business issues an invoice;
 *   - rewarding is admin-only, percentage rewards need a base, and it is
 *     one-shot (idempotent);
 *   - partners are platform-level: another tenant can't touch them.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import app from '../src/app.js';
import { qualifyReferrals } from '../src/services/referralService.js';

let server;
let base;

let tenantA;
let ownerToken;
let staffToken;
let adminToken;

let mainCode; // PERCENT 15, maxUses 5
let mainReferralId;

const FIXED_EMAILS = ['ref-owner@test.local', 'ref-staff@test.local', 'ref-admin@test.local'];
const TENANT_SLUGS = ['referral-co-a', 'referred-biz-one', 'referred-biz-two'];
const PARTNER_NAMES = ['Apex Resellers Ltd'];

const auth = (token, tenantId) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
  'X-Tenant-Id': tenantId,
});

async function api(method, path, { body, token = ownerToken, tenant = tenantA.id } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: auth(token, tenant),
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

/** Create a whole new business through the real signup flow. */
async function register(businessName, referralCode) {
  const slugSeed = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Referred Owner',
      email: `${slugSeed}@refsignups.test`,
      password: 'ChangeMe123!',
      referralCode,
      business: { name: businessName },
    }),
  });
  const json = await res.json().catch(() => null);
  return {
    status: res.status,
    json,
    tenantId: json?.data?.activeTenant?.id ?? null,
    token: json?.data?.accessToken ?? null,
  };
}

/** Issue one invoice in a business so its referral can qualify. */
async function issueInvoice(session) {
  const customer = await api('POST', '/api/customers', {
    body: { name: 'Referred Customer' },
    token: session.token,
    tenant: session.tenantId,
  });
  assert.equal(customer.status, 201, JSON.stringify(customer.json));

  const invoice = await api(
    'POST',
    '/api/invoices',
    {
      body: {
        customerId: customer.json.data.id,
        invoiceDate: new Date().toISOString().slice(0, 10),
        items: [{ description: 'Onboarding service', quantity: 1, unitPrice: 25000 }],
      },
      token: session.token,
      tenant: session.tenantId,
    }
  );
  assert.equal(invoice.status, 201, JSON.stringify(invoice.json));
  return invoice.json.data;
}

async function cleanup() {
  const tenants = await prisma.tenant.findMany({
    where: { OR: [{ slug: { in: TENANT_SLUGS } }, { name: { startsWith: 'Referred Biz' } }] },
    select: { id: true },
  });
  const tenantIds = tenants.map((t) => t.id);

  const partners = await prisma.partner.findMany({ where: { name: { in: PARTNER_NAMES } }, select: { id: true } });
  const partnerIds = partners.map((p) => p.id);

  if (partnerIds.length) {
    await prisma.referralCode.deleteMany({ where: { ownerType: 'PARTNER', ownerId: { in: partnerIds } } });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
  }
  if (tenantIds.length) {
    await prisma.referral.deleteMany({
      where: { OR: [{ referredTenantId: { in: tenantIds } }, { referrerTenantId: { in: tenantIds } }] },
    });
    await prisma.referralCode.deleteMany({ where: { ownerId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.user.deleteMany({
    where: { OR: [{ email: { in: FIXED_EMAILS } }, { email: { endsWith: '@refsignups.test' } }] },
  });
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  await cleanup();

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);

  tenantA = await prisma.tenant.create({ data: { name: 'Referral Co A', slug: 'referral-co-a' } });
  const owner = await prisma.user.create({
    data: { name: 'Referral Owner', email: 'ref-owner@test.local', passwordHash, emailVerified: true },
  });
  await prisma.membership.create({
    data: { userId: owner.id, tenantId: tenantA.id, role: 'OWNER', status: 'ACTIVE' },
  });

  const staff = await prisma.user.create({
    data: { name: 'Referral Staff', email: 'ref-staff@test.local', passwordHash, emailVerified: true },
  });
  await prisma.membership.create({
    data: { userId: staff.id, tenantId: tenantA.id, role: 'STAFF', status: 'ACTIVE' },
  });

  const platformAdmin = await prisma.user.create({
    data: { name: 'Platform Admin', email: 'ref-admin@test.local', passwordHash, emailVerified: true, isPlatformAdmin: true },
  });

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

  ownerToken = await login('ref-owner@test.local');
  staffToken = await login('ref-staff@test.local');
  adminToken = await login('ref-admin@test.local');
  await prisma.user.update({ where: { id: platformAdmin.id }, data: { isPlatformAdmin: true } });
});

after(async () => {
  try {
    await cleanup();
    await prisma.$disconnect();
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

/* ── codes ────────────────────────────────────────────────────────── */

test('an owner creates a shareable referral code', async () => {
  const res = await api('POST', '/api/referrals/codes', {
    body: { rewardType: 'PERCENT', rewardValue: 15, maxUses: 5 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const code = res.json.data;
  mainCode = code.code;
  assert.match(code.code, /^TG[A-Z0-9]{6}$/, 'auto codes are short, uppercase and unambiguous');
  assert.equal(code.rewardValue, 15);
  assert.equal(code.maxUses, 5);
  assert.match(code.shareUrl, new RegExp(`/register\\?ref=${code.code}$`));
});

test('a staff member cannot run the referral programme', async () => {
  const read = await api('GET', '/api/referrals', { token: staffToken });
  assert.equal(read.status, 403);

  const write = await api('POST', '/api/referrals/codes', { body: { rewardValue: 10 }, token: staffToken });
  assert.equal(write.status, 403);
});

test('a custom code cannot be taken twice', async () => {
  const first = await api('POST', '/api/referrals/codes', { body: { code: 'INVITE99', rewardType: 'FIXED', rewardValue: 500 } });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.data.code, 'INVITE99');

  const duplicate = await api('POST', '/api/referrals/codes', {
    body: { code: 'invite99', rewardType: 'FIXED', rewardValue: 500 },
  });
  assert.equal(duplicate.status, 409);
});

test('the public lookup validates a code without leaking anything else', async () => {
  const known = await fetch(`${base}/api/public/referral/${mainCode}`);
  assert.equal(known.status, 200);
  const knownBody = await known.json();
  assert.equal(knownBody.data.valid, true);
  assert.equal(knownBody.data.ownerLabel, 'Referral Co A');

  const unknown = await fetch(`${base}/api/public/referral/NOPE999`);
  assert.equal(unknown.status, 200);
  const unknownBody = await unknown.json();
  assert.equal(unknownBody.data.valid, false);
});

/* ── attribution ──────────────────────────────────────────────────── */

test('signing up with a code attributes the referral exactly once', async () => {
  const signup = await register('Referred Biz One', mainCode);
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.ok(signup.tenantId);

  const referral = await prisma.referral.findFirst({ where: { referredTenantId: signup.tenantId } });
  assert.ok(referral, 'the new business must be linked to the code');
  assert.equal(referral.status, 'PENDING');
  assert.equal(referral.referrerTenantId, tenantA.id);

  const row = await prisma.referralCode.findUnique({ where: { code: mainCode } });
  assert.equal(row.uses, 1, 'the code counts its own use');

  // Running attribution again for the same business never duplicates it.
  const { attributeReferral } = await import('../src/services/referralService.js');
  const again = await attributeReferral({ code: mainCode, referredTenantId: signup.tenantId });
  assert.equal(again.id, referral.id);
  assert.equal(await prisma.referral.count({ where: { referredTenantId: signup.tenantId } }), 1);
});

test('a code with a usage limit is honoured and signup still succeeds', async () => {
  const created = await api('POST', '/api/referrals/codes', {
    body: { rewardType: 'PERCENT', rewardValue: 10, maxUses: 1 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  const first = await register('Referred Biz Two', created.json.data.code);
  assert.equal(first.status, 201, JSON.stringify(first.json));

  const second = await register('Referred Biz Three', created.json.data.code);
  assert.equal(second.status, 201, 'an exhausted code must not block the visitor from signing up');

  assert.equal(await prisma.referral.count({ where: { codeId: created.json.data.id } }), 1, 'only the first use counts');
  const exhausted = await fetch(`${base}/api/public/referral/${created.json.data.code}`);
  const body = await exhausted.json();
  assert.equal(body.data.valid, false, 'the lookup now reports the code as unusable');
});

test('an unknown code never blocks signup', async () => {
  const signup = await register('Referred Biz Four', 'TOTALLYBOGUS');
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal(await prisma.referral.count({ where: { referredTenantId: signup.tenantId } }), 0);
});

test('the dashboard shows the codes, referrals and stats for this business', async () => {
  const res = await api('GET', '/api/referrals');
  assert.equal(res.status, 200, JSON.stringify(res.json));

  const { codes, referrals, stats } = res.json.data;
  assert.equal(codes.length, 3, 'every code this business created is listed');
  assert.equal(stats.total, 2, 'two businesses were attributed to this business');
  assert.equal(stats.byStatus.PENDING, 2);
  assert.equal(stats.codes, 3);
  assert.ok(referrals.every((r) => r.referrerTenantId === tenantA.id));
  assert.ok(referrals.every((r) => r.referred.name.startsWith('Referred Biz')));
});

test('a used code cannot be deleted, only deactivated', async () => {
  const list = await api('GET', '/api/referrals');
  const used = list.json.data.codes.find((c) => c.uses > 0);

  const del = await api('DELETE', `/api/referrals/codes/${used.id}`);
  assert.equal(del.status, 400);
  assert.match(JSON.stringify(del.json), /deactivate/i);

  const patched = await api('PATCH', `/api/referrals/codes/${used.id}`, { body: { active: false } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.active, false);
});

/* ── qualification + rewards ──────────────────────────────────────── */

test('a referral qualifies once the referred business issues an invoice', async () => {
  const signup = await register('Referred Biz Five', mainCode);
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  const referral = await prisma.referral.findFirst({ where: { referredTenantId: signup.tenantId } });
  assert.equal(referral.status, 'PENDING');

  await issueInvoice(signup);

  const report = await qualifyReferrals();
  assert.ok(report.activated >= 1, 'the invoice is the qualification signal');

  const refreshed = await prisma.referral.findUnique({ where: { id: referral.id } });
  assert.equal(refreshed.status, 'ACTIVE');
  mainReferralId = referral.id;
});

test('crediting a percentage reward needs a base amount', async () => {
  const { status, json } = await api('POST', `/api/admin/referrals/${mainReferralId}/reward`, { token: adminToken });
  assert.equal(status, 400, JSON.stringify(json));
  assert.match(JSON.stringify(json), /plan value|base/i);
});

test('a platform admin credits the reward, and only once', async () => {
  const rewarded = await api('POST', `/api/admin/referrals/${mainReferralId}/reward`, {
    body: { baseAmount: 10000 },
    token: adminToken,
  });
  assert.equal(rewarded.status, 200, JSON.stringify(rewarded.json));
  assert.equal(rewarded.json.data.status, 'REWARDED');
  assert.equal(rewarded.json.data.rewardAmount, 1500, '15% of 10,000');

  const again = await api('POST', `/api/admin/referrals/${mainReferralId}/reward`, {
    body: { baseAmount: 99999 },
    token: adminToken,
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.data.alreadyRewarded, true, 'rewarding is one-shot');
  assert.equal(again.json.data.rewardAmount, 1500, 'the original amount stands');
});

test('a tenant user cannot reach the platform referral endpoints', async () => {
  const list = await api('GET', '/api/admin/referrals');
  assert.equal(list.status, 403);

  const reward = await api('POST', `/api/admin/referrals/${mainReferralId}/reward`, { body: { baseAmount: 1000 } });
  assert.equal(reward.status, 403);
});

/* ── partners ─────────────────────────────────────────────────────── */

test('the platform manages resellers/accountants and their codes', async () => {
  const created = await api('POST', '/api/admin/partners', {
    body: { name: 'Apex Resellers Ltd', type: 'RESELLER', commissionRate: 25, email: 'apex@partners.test' },
    token: adminToken,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const partner = created.json.data;
  assert.equal(partner.type, 'RESELLER');
  assert.equal(partner.commissionRate, 25);

  const code = await api('POST', `/api/admin/partners/${partner.id}/codes`, {
    body: { rewardType: 'FIXED', rewardValue: 750 },
    token: adminToken,
  });
  assert.equal(code.status, 201, JSON.stringify(code.json));
  assert.equal(code.json.data.ownerLabel, 'Apex Resellers Ltd');

  const signup = await register('Referred Biz Six', code.json.data.code);
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  const referral = await prisma.referral.findFirst({ where: { referredTenantId: signup.tenantId } });
  assert.equal(referral.referrerTenantId, null, 'a partner referral belongs to the partner, not a tenant');

  await issueInvoice(signup);
  await qualifyReferrals();

  const detail = await api('GET', '/api/admin/partners/' + partner.id, { token: adminToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  assert.equal(detail.json.data.codes.length, 1);
  assert.ok(detail.json.data.stats.referrals >= 1);

  const reward = await api('POST', `/api/admin/referrals/${referral.id}/reward`, { token: adminToken });
  assert.equal(reward.status, 200, JSON.stringify(reward.json));
  assert.equal(reward.json.data.rewardAmount, 750, 'fixed reward needs no base');

  const rolled = await api('GET', '/api/admin/partners/' + partner.id, { token: adminToken });
  assert.equal(rolled.json.data.stats.commission, 750, 'commission is the sum of rewards on their codes');
});

test('a partner who owns codes cannot be deleted', async () => {
  const list = await api('GET', '/api/admin/partners', { token: adminToken });
  const partner = list.json.data.find((p) => p.name === 'Apex Resellers Ltd');
  assert.ok(partner);

  const del = await api('DELETE', `/api/admin/partners/${partner.id}`, { token: adminToken });
  assert.equal(del.status, 400);

  const suspended = await api('PATCH', `/api/admin/partners/${partner.id}`, { body: { status: 'SUSPENDED' }, token: adminToken });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.json.data.status, 'SUSPENDED');
});

test('partners are invisible to ordinary tenants', async () => {
  const list = await api('GET', '/api/admin/partners');
  assert.equal(list.status, 403);
});
