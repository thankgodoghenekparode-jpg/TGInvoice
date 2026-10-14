/**
 * Feature flags: server-side rollout (off, 100%, 0%, percentage, allowlist),
 * public read, and platform-admin-only management.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import app from '../src/app.js';
import { getFlagsForTenant, upsertFlag, removeFlag } from '../src/services/featureFlagService.js';

let server;
let base;
let tenantA;
let tenantB;
let memberToken;

const KEY = 'flags-test-flag';

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  await prisma.featureFlag.deleteMany({ where: { key: KEY } });

  tenantA = await prisma.tenant.create({ data: { name: 'Flags A', slug: 'flags-tenant-a' } });
  tenantB = await prisma.tenant.create({ data: { name: 'Flags B', slug: 'flags-tenant-b' } });

  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const user = await prisma.user.create({
    data: { name: 'Flags Member', email: 'flags-member@test.local', passwordHash, emailVerified: true },
  });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenantA.id, role: 'ADMIN', status: 'ACTIVE' } });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'flags-member@test.local', password: 'ChangeMe123!' }),
  });
  const json = await login.json();
  assert.equal(login.status, 200, 'login must succeed');
  memberToken = json.data.accessToken;
});

after(async () => {
  await prisma.featureFlag.deleteMany({ where: { key: KEY } });
  await prisma.membership.deleteMany({ where: { tenantId: tenantA.id } });
  await prisma.user.deleteMany({ where: { email: 'flags-member@test.local' } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function readFlags(tenantId, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/api/flags`, { headers });
  assert.equal(res.status, 200);
  return (await res.json()).flags;
}

test('a flag that does not exist reads as off', async () => {
  const flags = await readFlags(tenantA.id);
  assert.equal(flags[KEY], undefined, 'unknown flags are simply absent');
});

test('disabled flag is off; enabling it at 100% turns it on for every tenant', async () => {
  await upsertFlag({ key: KEY, enabled: false });
  assert.equal((await readFlags(tenantA.id))[KEY], false);

  await upsertFlag({ key: KEY, enabled: true, rollout: 100 });
  assert.equal((await readFlags(tenantA.id))[KEY], true);
  assert.equal((await readFlags(tenantB.id))[KEY], true, '100% rollout reaches every tenant');
});

test('rollout 0 turns it off again', async () => {
  await upsertFlag({ key: KEY, enabled: true, rollout: 0 });
  assert.equal((await readFlags(tenantA.id))[KEY], false);
});

test('a partial rollout is deterministic — the same tenant always lands the same way', async () => {
  await upsertFlag({ key: KEY, enabled: true, rollout: 50 });
  const first = (await readFlags(tenantA.id))[KEY];
  assert.equal(typeof first, 'boolean');
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await getFlagsForTenant(tenantA.id))[KEY], first, 'repeated reads must not flicker');
  }
  // Other flags must not affect this bucket.
  assert.notEqual((await getFlagsForTenant(tenantB.id))[KEY], undefined);
  await prisma.featureFlag.deleteMany({ where: { key: KEY } });
});

test('an allowlist restricts the flag to named tenants regardless of rollout', async () => {
  await upsertFlag({ key: KEY, enabled: true, rollout: 100, tenantIds: [tenantA.id] });
  assert.equal((await readFlags(tenantA.id))[KEY], true, 'the allowlisted tenant sees it');
  assert.equal((await readFlags(tenantB.id))[KEY], false, 'everyone else does not');
  assert.equal((await readFlags(null))[KEY], false, 'an anonymous reader never matches an allowlist');
  await prisma.featureFlag.deleteMany({ where: { key: KEY } });
});

test('flags are public to read but only platform admins may manage them', async () => {
  // Public read — no auth header at all.
  const anon = await fetch(`${base}/api/flags`);
  assert.equal(anon.status, 200);

  // A regular tenant member must be refused.
  const res = await fetch(`${base}/api/admin/flags`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
  });
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);

  // Unauthenticated admin access is rejected outright.
  const noAuth = await fetch(`${base}/api/admin/flags`);
  assert.equal(noAuth.status, 401);
});

test('upsert validates the flag key shape', async () => {
  const res = await fetch(`${base}/api/flags/does-not-exist`);
  assert.equal(res.status, 404, 'unknown flag keys resolve to nothing');
  assert.equal(await removeFlag('00000000-0000-0000-0000-000000000000'), null);
});
