/**
 * Platform-admin capability tests.
 *
 * Proves the super-admin surface (behind requirePlatformAdmin) can:
 *   - register a new business and attach an existing account as owner
 *   - suspend / activate a business (every member is blocked while suspended)
 *   - grant / revoke access to a business
 *   - suspend / activate an account (sessions die immediately)
 *   - grant / revoke platform-admin access
 * …and that a normal tenant user is refused every one of those routes.
 *
 * Requires: reachable PostgreSQL (DATABASE_URL) and `npx prisma generate`.
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
let superToken;
let victimToken;

const SUPER_EMAIL = 'adm-super@test.local';
const VICTIM_EMAIL = 'adm-victim@test.local';
const EXTRA_EMAIL = 'adm-extra@test.local';
const NEW_OP_EMAIL = 'adm-operator@test.local';
const PASSWORD = 'ChangeMe123!';
const SUFFIX = Date.now().toString(36);
const SLUGS = [`adm-business-${SUFFIX}`, `adm-business-${SUFFIX}-2`];

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
    /* non-JSON */
  }
  return { status: res.status, json };
}

async function login(email) {
  const res = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  return { status: res.status, json: res.json, token: res.json?.data?.accessToken };
}

before(async () => {
  await listen();
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  await prisma.user.create({
    data: { name: 'Platform Super', email: SUPER_EMAIL, passwordHash, emailVerified: true, isPlatformAdmin: true, status: 'ACTIVE' },
  });
  await prisma.user.create({
    data: { name: 'Victim Owner', email: VICTIM_EMAIL, passwordHash, emailVerified: true, status: 'ACTIVE' },
  });
  await prisma.user.create({
    data: { name: 'Extra Staff', email: EXTRA_EMAIL, passwordHash, emailVerified: true, status: 'ACTIVE' },
  });

  superToken = (await login(SUPER_EMAIL)).token;
  victimToken = (await login(VICTIM_EMAIL)).token;
  assert.ok(superToken && victimToken, 'seeded logins must succeed');
});

after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: `adm-business-${SUFFIX}` } } });
  await prisma.user.deleteMany({ where: { email: { in: [SUPER_EMAIL, VICTIM_EMAIL, EXTRA_EMAIL, NEW_OP_EMAIL] } } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('a normal user is refused every platform-admin route', async () => {
  assert.equal((await api('GET', '/api/admin/overview', { token: victimToken })).status, 403);
  assert.equal((await api('POST', '/api/admin/tenants', { token: victimToken, body: { name: 'Nope Ltd' } })).status, 403);
  assert.equal((await api('GET', '/api/admin/users', { token: victimToken })).status, 403);
});

test('super-admin registers a business and attaches an existing owner', async () => {
  const res = await api('POST', '/api/admin/tenants', {
    token: superToken,
    body: { name: `Adm Business ${SUFFIX}`, ownerEmail: VICTIM_EMAIL, currency: { code: 'USD', symbol: '$', position: 'prefix' } },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.status, 'ACTIVE');
  assert.equal(res.json.data.owner.email, VICTIM_EMAIL);

  // The owner now sees it as their own active business.
  const list = await api('GET', '/api/tenants', { token: victimToken });
  assert.equal(list.status, 200);
  const mine = list.json.data.find((t) => t.id === res.json.data.id);
  assert.ok(mine, 'owner must belong to the new business');
  assert.equal(mine.role, 'OWNER');

  // Creating without an owner is allowed too.
  const orphan = await api('POST', '/api/admin/tenants', { token: superToken, body: { name: `Adm Business ${SUFFIX} 2` } });
  assert.equal(orphan.status, 201);
  assert.equal(orphan.json.data.owner, null);
});

test('suspending a business blocks every one of its members', async () => {
  const list = await api('GET', `/api/admin/tenants?q=Adm%20Business%20${SUFFIX}`, { token: superToken });
  const tenant = list.json.data.find((t) => t.slug === SLUGS[0]) || list.json.data[0];
  assert.ok(tenant, 'created business must be listed');

  // Owner can operate normally before suspension.
  assert.equal((await api('GET', '/api/customers', { token: victimToken, tenant: tenant.id })).status, 200);

  const suspended = await api('POST', `/api/admin/tenants/${tenant.id}/suspend`, { token: superToken });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.json.data.status, 'SUSPENDED');

  // Member is blocked and the business disappears from their list.
  const blocked = await api('GET', '/api/customers', { token: victimToken, tenant: tenant.id });
  assert.equal(blocked.status, 403);
  const listAfter = await api('GET', '/api/tenants', { token: victimToken });
  assert.ok(!listAfter.json.data.some((t) => t.id === tenant.id), 'suspended business must not be listed');

  // Reactivating restores access.
  assert.equal((await api('POST', `/api/admin/tenants/${tenant.id}/activate`, { token: superToken })).status, 200);
  assert.equal((await api('GET', '/api/customers', { token: victimToken, tenant: tenant.id })).status, 200);
});

test('grant and revoke tenant-admin access — staff are out of the platform scope', async () => {
  const list = await api('GET', `/api/admin/tenants?q=Adm%20Business%20${SUFFIX}`, { token: superToken });
  const tenant = list.json.data.find((t) => t.slug === SLUGS[0]);

  // Tenant staff are the tenant admin's concern — the platform API refuses STAFF.
  const staff = await api('POST', `/api/admin/tenants/${tenant.id}/members`, {
    token: superToken,
    body: { email: EXTRA_EMAIL, role: 'STAFF' },
  });
  assert.equal(staff.status, 400, 'a platform admin cannot grant STAFF access');

  const grant = await api('POST', `/api/admin/tenants/${tenant.id}/members`, {
    token: superToken,
    body: { email: EXTRA_EMAIL, role: 'ADMIN' },
  });
  assert.equal(grant.status, 200);
  assert.equal(grant.json.data.membership.role, 'ADMIN');

  const detail = await api('GET', `/api/admin/tenants/${tenant.id}`, { token: superToken });
  const extra = detail.json.data.members.find((m) => m.user.email === EXTRA_EMAIL);
  assert.ok(extra, 'granted member must appear');
  assert.equal(extra.role, 'ADMIN');

  const revoke = await api('DELETE', `/api/admin/tenants/${tenant.id}/members/${grant.json.data.user.id}`, { token: superToken });
  assert.equal(revoke.status, 200);

  const detail2 = await api('GET', `/api/admin/tenants/${tenant.id}`, { token: superToken });
  assert.ok(!detail2.json.data.members.some((m) => m.user.email === EXTRA_EMAIL), 'revoked member must be gone');
});

test('the only owner of a business cannot be revoked', async () => {
  const list = await api('GET', `/api/admin/tenants?q=Adm%20Business%20${SUFFIX}`, { token: superToken });
  const tenant = list.json.data.find((t) => t.slug === SLUGS[0]);
  const victim = await prisma.user.findUnique({ where: { email: VICTIM_EMAIL }, select: { id: true } });

  const res = await api('DELETE', `/api/admin/tenants/${tenant.id}/members/${victim.id}`, { token: superToken });
  assert.equal(res.status, 400, 'removing the last owner must be refused');
});

test('suspending an account kills sessions and blocks login; activate restores it', async () => {
  const victim = await prisma.user.findUnique({ where: { email: VICTIM_EMAIL }, select: { id: true } });

  const susp = await api('POST', `/api/admin/users/${victim.id}/suspend`, { token: superToken });
  assert.equal(susp.status, 200);
  assert.equal(susp.json.data.status, 'SUSPENDED');

  // Existing access token is refused immediately.
  assert.equal((await api('GET', '/api/tenants', { token: victimToken })).status, 403);
  // And they can no longer sign in.
  assert.equal((await login(VICTIM_EMAIL)).status, 403);

  const act = await api('POST', `/api/admin/users/${victim.id}/activate`, { token: superToken });
  assert.equal(act.status, 200);
  assert.equal((await login(VICTIM_EMAIL)).status, 200);
});

test('granting and revoking platform-admin access', async () => {
  const extra = await prisma.user.findUnique({ where: { email: EXTRA_EMAIL }, select: { id: true } });

  const grant = await api('PATCH', `/api/admin/users/${extra.id}/platform-admin`, { token: superToken, body: { isPlatformAdmin: true } });
  assert.equal(grant.status, 200);
  assert.equal(grant.json.data.isPlatformAdmin, true);

  const extraToken = (await login(EXTRA_EMAIL)).token;
  assert.equal((await api('GET', '/api/admin/overview', { token: extraToken })).status, 200, 'new admin can use the admin API');

  const revoke = await api('PATCH', `/api/admin/users/${extra.id}/platform-admin`, { token: superToken, body: { isPlatformAdmin: false } });
  assert.equal(revoke.status, 200);
  assert.equal(revoke.json.data.isPlatformAdmin, false);
});

test('a platform admin cannot suspend or demote themselves', async () => {
  const me = await prisma.user.findUnique({ where: { email: SUPER_EMAIL }, select: { id: true } });
  assert.equal((await api('POST', `/api/admin/users/${me.id}/suspend`, { token: superToken })).status, 400);
  assert.equal((await api('PATCH', `/api/admin/users/${me.id}/platform-admin`, { token: superToken, body: { isPlatformAdmin: false } })).status, 400);
});

test('the platform Users directory lists platform operators only', async () => {
  const res = await api('GET', '/api/admin/users?limit=100', { token: superToken });
  assert.equal(res.status, 200);
  assert.ok(res.json.data.length >= 1, 'at least the seeded platform admin is listed');
  assert.ok(res.json.data.every((u) => u.isPlatformAdmin === true), 'only platform operators are listed');
  assert.ok(res.json.data.some((u) => u.email === SUPER_EMAIL));
  assert.ok(!res.json.data.some((u) => u.email === VICTIM_EMAIL), 'tenant users never appear in the platform directory');
});

test('add a platform operator — promote an existing account or create a new one', async () => {
  // Promote an existing (tenant) account.
  const promote = await api('POST', '/api/admin/users', { token: superToken, body: { email: VICTIM_EMAIL } });
  assert.equal(promote.status, 200);
  assert.equal(promote.json.data.promoted, true);
  assert.equal(promote.json.data.user.isPlatformAdmin, true);
  assert.equal(promote.json.data.temporaryPassword, null);
  assert.equal((await api('GET', '/api/admin/overview', { token: victimToken })).status, 200, 'promoted user can use the admin API');

  // Create a brand-new operator — returns a one-time temporary password.
  const create = await api('POST', '/api/admin/users', { token: superToken, body: { name: 'New Operator', email: NEW_OP_EMAIL } });
  assert.equal(create.status, 201);
  assert.equal(create.json.data.created, true);
  assert.equal(create.json.data.user.isPlatformAdmin, true);
  assert.ok(create.json.data.temporaryPassword && create.json.data.temporaryPassword.length >= 8);

  // The temporary password actually works.
  const signIn = await api('POST', '/api/auth/login', { body: { email: NEW_OP_EMAIL, password: create.json.data.temporaryPassword } });
  assert.equal(signIn.status, 200);
  assert.equal((await api('GET', '/api/admin/overview', { token: signIn.json.data.accessToken })).status, 200);

  // Adding the same email again is refused.
  assert.equal((await api('POST', '/api/admin/users', { token: superToken, body: { email: NEW_OP_EMAIL } })).status, 409);
});

test('notifications: list, mark one read, mark all read', async () => {
  // The victim received notices for the earlier grant/revoke/suspend actions.
  const signIn = await login(VICTIM_EMAIL);
  assert.equal(signIn.status, 200);
  const token = signIn.token;

  const list = await api('GET', '/api/notifications', { token });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.data));
  assert.ok(list.json.data.length >= 1, 'the acted-on user has in-app notifications');
  assert.equal(typeof list.json.meta.unread, 'number');

  const first = list.json.data[0];
  assert.equal((await api('POST', `/api/notifications/${first.id}/read`, { token })).status, 200);

  const all = await api('POST', '/api/notifications/read-all', { token });
  assert.equal(all.status, 200);
  assert.equal(all.json.data.unread, 0);
  assert.equal((await api('GET', '/api/notifications/unread-count', { token })).json.data.unread, 0);
});
