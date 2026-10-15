/**
 * CSV / Excel import.
 *
 * The behaviour that matters:
 *   - preview parses + validates and writes nothing;
 *   - commits create vs update using tenant-scoped dedupe keys;
 *   - one bad row never blocks the good ones;
 *   - numbers (prices/tax) survive real-world formatting;
 *   - .xlsx is read as well as .csv;
 *   - another tenant's data is never touched.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { prisma } from '../src/prisma.js';
import app from '../src/app.js';

let server;
let base;
let tenantA;
let tenantB;
let tokenA;
let tokenB;

const SLUGS = ['imp-tenant-a', 'imp-tenant-b'];
const EMAILS = ['imp-owner@test.local', 'imp-b@test.local'];

const auth = (token, tenantId) => ({ Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId });

/** POST a multipart file (string → CSV blob, Buffer → raw blob). */
async function postFile(path, file, fileName, { token = tokenA, tenantId = tenantA.id } = {}) {
  const fd = new FormData();
  const blob = typeof file === 'string' ? new Blob([file], { type: 'text/csv' }) : new Blob([file]);
  fd.append('file', blob, fileName);
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: auth(token, tenantId), body: fd });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const preview = (type, csv, opts) => postFile(`/api/imports/${type}/preview`, csv, `${type}.csv`, opts);
const commit = (type, csv, opts) => postFile(`/api/imports/${type}`, csv, `${type}.csv`, opts);

async function createUser(email, name) {
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  return prisma.user.create({ data: { name, email, passwordHash, emailVerified: true } });
}

async function login(email) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ChangeMe123!' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `login for ${email}: ${JSON.stringify(body)}`);
  return body.data.accessToken;
}

async function cleanup() {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } }, select: { id: true } });
  const ids = tenants.map((t) => t.id);
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await cleanup();

  tenantA = await prisma.tenant.create({ data: { name: 'Import Co', slug: 'imp-tenant-a' } });
  const owner = await createUser('imp-owner@test.local', 'Import Owner');
  await prisma.membership.create({ data: { userId: owner.id, tenantId: tenantA.id, role: 'OWNER', status: 'ACTIVE' } });
  tokenA = await login('imp-owner@test.local');

  tenantB = await prisma.tenant.create({ data: { name: 'Import Co B', slug: 'imp-tenant-b' } });
  const other = await createUser('imp-b@test.local', 'Import B');
  await prisma.membership.create({ data: { userId: other.id, tenantId: tenantB.id, role: 'OWNER', status: 'ACTIVE' } });
  tokenB = await login('imp-b@test.local');
});

after(async () => {
  try {
    await cleanup();
    await prisma.$disconnect();
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

/* ── template ─────────────────────────────────────────────────────── */

test('template download returns a fill-in CSV', async () => {
  const res = await fetch(`${base}/api/imports/customers/template`, { headers: auth(tokenA, tenantA.id) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const text = await res.text();
  assert.ok(text.includes('Name'));
  assert.ok(text.includes('Email'));
  assert.ok(text.includes('Customer code'));
});

/* ── preview ──────────────────────────────────────────────────────── */

test('preview validates every row and writes nothing', async () => {
  const csv = [
    'Name,Email,City',
    'Ada Obi,ada@example.com,Lagos',
    'Bad Row,not-an-email,Kano',
    ',noname@example.com,Jos',
  ].join('\n');

  const { status, json } = await preview('customers', csv);
  assert.equal(status, 200, JSON.stringify(json));
  const data = json.data;

  assert.equal(data.summary.total, 3);
  assert.equal(data.summary.create, 1);
  assert.equal(data.summary.errors, 2);

  assert.equal(data.rows[0].action, 'create');
  assert.equal(data.rows[0].values.name, 'Ada Obi');
  assert.match(data.rows[1].errors[0], /valid email/i);
  assert.match(data.rows[2].errors[0], /Name is required/i);
  assert.equal(data.rows[2].sourceRow, 4, 'errors point at the spreadsheet row');

  assert.equal(await prisma.customer.count({ where: { tenantId: tenantA.id } }), 0, 'preview must not write');
});

test('a missing required column is reported up front', async () => {
  const { status, json } = await preview('customers', 'Phone\n+2348012345678\n');
  assert.equal(status, 200);
  assert.deepEqual(json.data.missingRequired, ['Name']);
  assert.equal(json.data.summary.total, 0);
  assert.equal(json.data.rows.length, 0);
});

/* ── customers ────────────────────────────────────────────────────── */

test('commit creates customers and allocates codes', async () => {
  const csv = [
    'Name,Email,Company',
    'Ada Obi,ada@example.com,Zarox Energy Ltd',
    'Bola Ade,bola@example.com,',
  ].join('\n');

  const { status, json } = await commit('customers', csv);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.data.created, 2);
  assert.equal(json.data.updated, 0);
  assert.deepEqual(json.data.errors, []);

  const ada = await prisma.customer.findFirst({ where: { tenantId: tenantA.id, email: 'ada@example.com' } });
  assert.equal(ada.name, 'Ada Obi');
  assert.equal(ada.companyName, 'Zarox Energy Ltd');
  assert.match(ada.customerCode, /^CUS-\d{5}$/);

  const bola = await prisma.customer.findFirst({ where: { tenantId: tenantA.id, email: 'bola@example.com' } });
  assert.match(bola.customerCode, /^CUS-\d{5}$/);
  assert.notEqual(ada.customerCode, bola.customerCode);
});

test('re-importing updates matching records instead of duplicating', async () => {
  const csv = ['Name,Email,City', 'Ada Obi,ada@example.com,Abuja', 'Chidi Eze,chidi@example.com,Enugu'].join('\n');

  const { status, json } = await commit('customers', csv);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.data.updated, 1);
  assert.equal(json.data.created, 1);

  assert.equal(await prisma.customer.count({ where: { tenantId: tenantA.id } }), 3);
  const ada = await prisma.customer.findFirst({ where: { tenantId: tenantA.id, email: 'ada@example.com' } });
  assert.equal(ada.city, 'Abuja');
});

test('rows that duplicate each other inside one file are flagged', async () => {
  const csv = ['Name,Email', 'Dup One,dup@example.com', 'Dup Two,dup@example.com'].join('\n');

  const plan = await preview('customers', csv);
  assert.equal(plan.json.data.summary.create, 1);
  assert.equal(plan.json.data.summary.errors, 1);
  assert.match(plan.json.data.rows[1].errors[0], /row 2/);

  const { json } = await commit('customers', csv);
  assert.equal(json.data.created, 1);
  assert.equal(json.data.skipped, 1);
});

/* ── products ─────────────────────────────────────────────────────── */

test('product prices and tax rates survive real-world formatting', async () => {
  const csv = ['Name,Description,Unit,Unit price,Tax rate,Active', 'Site survey,Initial assessment,visit,"₦75,000",7.5,yes'].join('\n');

  const { status, json } = await commit('products', csv);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.data.created, 1);

  const product = await prisma.product.findFirst({ where: { tenantId: tenantA.id, name: 'Site survey' } });
  assert.equal(Number(product.unitPrice), 75000);
  assert.equal(Number(product.taxRate), 7.5);
  assert.equal(product.unit, 'visit');
  assert.equal(product.active, true);
});

test('products update by name on re-import', async () => {
  const { json } = await commit('products', 'Name,Unit price\nSite survey,80000\n');
  assert.equal(json.data.updated, 1);
  assert.equal(json.data.created, 0);

  const rows = await prisma.product.findMany({ where: { tenantId: tenantA.id, name: 'Site survey' } });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].unitPrice), 80000);
});

/* ── xlsx ─────────────────────────────────────────────────────────── */

test('real .xlsx workbooks are read', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Customers');
  ws.addRow(['Name', 'Email', 'City']);
  ws.addRow(['Xlsx Person', 'xlsx@example.com', 'Kano']);
  ws.addRow(['Second Person', 'second@example.com', 'Kaduna']);
  const buffer = await wb.xlsx.writeBuffer();

  const plan = await postFile('/api/imports/customers/preview', buffer, 'people.xlsx');
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  assert.equal(plan.json.data.summary.create, 2);

  const run = await postFile('/api/imports/customers', buffer, 'people.xlsx');
  assert.equal(run.json.data.created, 2);

  const person = await prisma.customer.findFirst({ where: { tenantId: tenantA.id, email: 'xlsx@example.com' } });
  assert.equal(person.name, 'Xlsx Person');
  assert.equal(person.city, 'Kano');
});

/* ── safety rails ─────────────────────────────────────────────────── */

test('another tenant never gets updated by an import', async () => {
  const csv = ['Name,Email', 'Isolated Copy,ada@example.com'].join('\n');
  const before = await prisma.customer.count({ where: { tenantId: tenantA.id } });

  const { status, json } = await commit('customers', csv, { token: tokenB, tenantId: tenantB.id });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.data.created, 1, 'it is a brand-new row in tenant B');
  assert.equal(json.data.updated, 0);

  assert.equal(await prisma.customer.count({ where: { tenantId: tenantB.id } }), 1);
  assert.equal(await prisma.customer.count({ where: { tenantId: tenantA.id } }), before, 'tenant A is untouched');
});

test('unsupported file types are rejected', async () => {
  const { status, json } = await postFile('/api/imports/customers', 'not a spreadsheet', 'photo.pdf');
  assert.equal(status, 400);
  assert.match(JSON.stringify(json), /csv|xlsx/i);
});

test('an old .xls file gets a helpful message', async () => {
  const { status, json } = await postFile('/api/imports/customers', 'binary-ish', 'legacy.xls');
  assert.equal(status, 400);
  assert.match(JSON.stringify(json), /save it as|xlsx/i);
});

test('an unknown import type is rejected', async () => {
  const { status } = await postFile('/api/imports/invoices', 'Name\nx\n', 'invoices.csv');
  assert.equal(status, 400);
});
