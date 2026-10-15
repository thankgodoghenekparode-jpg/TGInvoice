/**
 * Custom fields + document templates (the tenant's own document chrome).
 *
 * The invariants that matter:
 *   - field DEFINITIONS are owner/admin-only, per entity, unique per key;
 *   - VALUES are typed and validated (number/date/select/required) before they
 *     can reach the database, and they only ever land on a record in the same
 *     tenant;
 *   - a cleared value stays cleared;
 *   - templates are stored once per (tenant, kind), fall back to the built-in
 *     look when reset, and actually change the generated PDF.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import app from '../src/app.js';
import { buildDocumentPdf, getSettings } from '../src/services/documentService.js';
import { loadPrintableFields } from '../src/services/customFieldService.js';

let server;
let base;
let tenantA;
let tenantB;
let ownerToken;
let staffToken;
let tokenB;
let customerA;
let invoiceA;

const auth = (token, tenantId) => ({ Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId });

async function api(method, path, { token = ownerToken, tenantId = tenantA.id, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...auth(token, tenantId), 'Content-Type': 'application/json' },
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
  assert.equal(res.status, 200, `login for ${email} must succeed: ${JSON.stringify(body)}`);
  return body.data.accessToken;
}

const SLUGS = ['cf-tenant-a', 'cf-tenant-b'];
const EMAILS = ['cf-owner@test.local', 'cf-staff@test.local', 'cf-b@test.local'];

/** Remove anything a previous (possibly failed) run left behind. */
async function cleanup() {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } }, select: { id: true } });
  const ids = tenants.map((t) => t.id);
  await prisma.customFieldValue.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customField.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.documentTemplate.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.invoice.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await cleanup();

  // Tenant A: an owner and a staff member share it (roles are tested below).
  tenantA = await prisma.tenant.create({ data: { name: 'Custom Co', slug: 'cf-tenant-a' } });

  const owner = await createUser('cf-owner@test.local', 'Custom Owner');
  await prisma.membership.create({ data: { userId: owner.id, tenantId: tenantA.id, role: 'OWNER', status: 'ACTIVE' } });
  ownerToken = await login('cf-owner@test.local');

  const staff = await createUser('cf-staff@test.local', 'Custom Staff');
  await prisma.membership.create({ data: { userId: staff.id, tenantId: tenantA.id, role: 'STAFF', status: 'ACTIVE' } });
  staffToken = await login('cf-staff@test.local');

  // Tenant B: fully separate.
  tenantB = await prisma.tenant.create({ data: { name: 'Custom Co B', slug: 'cf-tenant-b' } });
  const b = await createUser('cf-b@test.local', 'Custom B');
  await prisma.membership.create({ data: { userId: b.id, tenantId: tenantB.id, role: 'OWNER', status: 'ACTIVE' } });
  tokenB = await login('cf-b@test.local');

  customerA = await prisma.customer.create({
    data: { tenantId: tenantA.id, customerCode: 'CUS-00001', name: 'Ada Obi' },
  });
  invoiceA = await prisma.invoice.create({
    data: {
      tenantId: tenantA.id,
      customerId: customerA.id,
      invoiceNumber: 'INV-00001',
      status: 'SENT',
      subtotal: 500,
      total: 500,
      balanceDue: 500,
      items: { create: [{ description: 'Work', quantity: 1, unitPrice: 500, amount: 500 }] },
    },
  });
});

after(async () => {
  try {
    await cleanup();
    await prisma.$disconnect();
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

/* ── field definitions ────────────────────────────────────────────── */

test('an owner can create a custom field and its key is slugged', async () => {
  const { status, json } = await api('POST', '/api/custom-fields', {
    body: { entity: 'INVOICE', label: 'Project Reference', type: 'TEXT', showOnDocument: true },
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.data.key, 'project_reference');
  assert.equal(json.data.entity, 'INVOICE');
  assert.equal(json.data.showOnDocument, true);
});

test('duplicate labels get a unique key rather than a 500', async () => {
  const a = await api('POST', '/api/custom-fields', {
    body: { entity: 'INVOICE', label: 'Project Reference', type: 'TEXT' },
  });
  assert.equal(a.status, 201);
  assert.equal(a.json.data.key, 'project_reference_2');
});

test('field definitions are tenant-scoped', async () => {
  const mine = await api('GET', '/api/custom-fields?entity=INVOICE');
  assert.equal(mine.status, 200);
  assert.ok(mine.json.data.length >= 2);

  const theirs = await api('GET', '/api/custom-fields?entity=INVOICE', { token: tokenB, tenantId: tenantB.id });
  assert.equal(theirs.status, 200);
  assert.equal(theirs.json.data.length, 0, 'another tenant must not see these fields');
});

test('a staff member cannot change field definitions', async () => {
  const create = await api('POST', '/api/custom-fields', {
    token: staffToken,
    body: { entity: 'INVOICE', label: 'Nope Field' },
  });
  assert.equal(create.status, 403);

  const list = await api('GET', '/api/custom-fields?entity=INVOICE', { token: staffToken });
  assert.equal(list.status, 200, 'staff can still read definitions');
});

test('a SELECT field must ship with options', async () => {
  const { status, json } = await api('POST', '/api/custom-fields', {
    body: { entity: 'QUOTATION', label: 'Priority', type: 'SELECT', options: [] },
  });
  assert.equal(status, 400);
  assert.ok(JSON.stringify(json).includes('option'));
});

test('updating a definition to SELECT still requires options', async () => {
  const create = await api('POST', '/api/custom-fields', {
    body: { entity: 'RECEIPT', label: 'Channel', type: 'TEXT' },
  });
  const id = create.json.data.id;

  const bad = await api('PATCH', `/api/custom-fields/${id}`, { body: { type: 'SELECT', options: [] } });
  assert.equal(bad.status, 400);

  const good = await api('PATCH', `/api/custom-fields/${id}`, {
    body: { type: 'SELECT', options: ['Walk-in', 'Online'] },
  });
  assert.equal(good.status, 200);
  assert.deepEqual(good.json.data.options, ['Walk-in', 'Online']);

  const del = await api('DELETE', `/api/custom-fields/${id}`);
  assert.equal(del.status, 200);
});

/* ── values ───────────────────────────────────────────────────────── */

let numberFieldKey;

test('values are typed and rejected when invalid', async () => {
  const def = await api('POST', '/api/custom-fields', {
    body: { entity: 'INVOICE', label: 'Order Weight', type: 'NUMBER' },
  });
  numberFieldKey = def.json.data.key;

  const bad = await api('PUT', '/api/custom-fields/values', {
    body: { entity: 'INVOICE', entityId: invoiceA.id, values: { [numberFieldKey]: 'heavy' } },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.details?.[0]?.path, numberFieldKey);

  const good = await api('PUT', '/api/custom-fields/values', {
    body: { entity: 'INVOICE', entityId: invoiceA.id, values: { [numberFieldKey]: '42.5' } },
  });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  const saved = good.json.data.fields.find((f) => f.key === numberFieldKey);
  assert.equal(saved.value, '42.5');
});

test('values read back and clearing a value sticks', async () => {
  const read = await api('GET', `/api/custom-fields/values?entity=INVOICE&entityId=${invoiceA.id}`);
  assert.equal(read.status, 200);
  const before = read.json.data.fields.find((f) => f.key === numberFieldKey);
  assert.equal(before.value, '42.5');

  const cleared = await api('PUT', '/api/custom-fields/values', {
    body: { entity: 'INVOICE', entityId: invoiceA.id, values: { [numberFieldKey]: '' } },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.data.fields.find((f) => f.key === numberFieldKey).value, null);

  const again = await api('GET', `/api/custom-fields/values?entity=INVOICE&entityId=${invoiceA.id}`);
  assert.equal(again.json.data.fields.find((f) => f.key === numberFieldKey).value, null);
});

test('SELECT values must come from the option list', async () => {
  await api('POST', '/api/custom-fields', {
    body: { entity: 'INVOICE', label: 'Delivery', type: 'SELECT', options: ['Courier', 'Pickup'] },
  });

  const bad = await api('PUT', '/api/custom-fields/values', {
    body: { entity: 'INVOICE', entityId: invoiceA.id, values: { delivery: 'Drone' } },
  });
  assert.equal(bad.status, 400);

  const good = await api('PUT', '/api/custom-fields/values', {
    body: { entity: 'INVOICE', entityId: invoiceA.id, values: { delivery: 'pickup' } },
  });
  assert.equal(good.status, 200, 'matching is case-insensitive');
  assert.equal(good.json.data.fields.find((f) => f.key === 'delivery').value, 'Pickup');
});

test('a required field must have a value', async () => {
  await api('POST', '/api/custom-fields', {
    body: { entity: 'INVOICE', label: 'PO Number', type: 'TEXT', required: true },
  });
  const { status, json } = await api('PUT', '/api/custom-fields/values', {
    body: { entity: 'INVOICE', entityId: invoiceA.id, values: { po_number: '' } },
  });
  assert.equal(status, 400);
  assert.ok(JSON.stringify(json).includes('PO Number'));
});

test('values can only target a record in the same tenant', async () => {
  const { status } = await api('PUT', '/api/custom-fields/values', {
    token: tokenB,
    tenantId: tenantB.id,
    body: { entity: 'INVOICE', entityId: invoiceA.id, values: { delivery: 'Pickup' } },
  });
  assert.equal(status, 400);
});

/* ── print-on-PDF path ────────────────────────────────────────────── */

test('only fields flagged for printing reach the document, and the PDF still builds', async () => {
  const saved = await api('PUT', '/api/custom-fields/values', {
    body: {
      entity: 'INVOICE',
      entityId: invoiceA.id,
      values: { project_reference: 'PHASE-3', po_number: 'PO-12345' },
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));

  const printable = await loadPrintableFields(tenantA.id, 'INVOICE', invoiceA.id);
  assert.equal(printable.length, 1, 'showOnDocument: false keeps a field off the PDF');
  assert.equal(printable[0].label, 'Project Reference');
  assert.equal(printable[0].value, 'PHASE-3');

  const settings = await getSettings(tenantA.id);
  const buffer = await buildDocumentPdf({
    kind: 'INVOICE',
    document: invoiceA,
    customer: customerA,
    settings,
    items: invoiceA.items || [],
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

/* ── document templates ───────────────────────────────────────────── */

test('a template is saved once per kind and read back with defaults filled in', async () => {
  const first = await api('PUT', '/api/document-templates/INVOICE', {
    body: { accentColor: '#FF0000', showLogo: false, showBankDetails: false, footerNote: 'Pay on time, please.' },
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.accentColor, '#FF0000');
  assert.equal(first.json.data.showLogo, false);

  const second = await api('PUT', '/api/document-templates/INVOICE', {
    body: { accentColor: '#FF0000', showLogo: true, showBankDetails: false, footerNote: 'Pay on time, please.' },
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.data.id, first.json.data.id, 'a second save must update, not duplicate');
  assert.equal(second.json.data.showLogo, true);

  const count = await prisma.documentTemplate.count({ where: { tenantId: tenantA.id, kind: 'INVOICE' } });
  assert.equal(count, 1);

  const read = await api('GET', '/api/document-templates/INVOICE');
  assert.equal(read.status, 200);
  assert.equal(read.json.data.accentColor, '#FF0000');
  assert.equal(read.json.data.footerNote, 'Pay on time, please.');

  // Unset kinds still report the built-in defaults.
  const quotation = await api('GET', '/api/document-templates/QUOTATION');
  assert.equal(quotation.json.data.accentColor, null);
  assert.equal(quotation.json.data.showLogo, true);
});

test('templates are tenant-scoped and admin-gated', async () => {
  const staff = await api('PUT', '/api/document-templates/QUOTATION', { token: staffToken, body: { accentColor: '#00AA00' } });
  assert.equal(staff.status, 403);

  const theirs = await api('GET', '/api/document-templates/QUOTATION', { token: tokenB, tenantId: tenantB.id });
  assert.equal(theirs.status, 200);
  assert.equal(theirs.json.data.accentColor, null, 'another tenant must not inherit this template');
});

test('an unknown document kind is rejected', async () => {
  const { status } = await api('PUT', '/api/document-templates/CUSTOMER', { body: { showLogo: false } });
  assert.equal(status, 400);
});

test('resetting a template restores the built-in look', async () => {
  const del = await api('DELETE', '/api/document-templates/INVOICE');
  assert.equal(del.status, 200);
  assert.equal(del.json.data.accentColor, null);
  assert.equal(del.json.data.showLogo, true);
  assert.equal(await prisma.documentTemplate.count({ where: { tenantId: tenantA.id, kind: 'INVOICE' } }), 0);
});

test('the template actually changes the generated PDF', async () => {
  const settings = await getSettings(tenantA.id);
  const quotation = {
    id: invoiceA.id,
    tenantId: tenantA.id,
    quotationNumber: 'QUO-00001',
    quotationDate: new Date(),
    validUntil: new Date(),
    reference: 'REF-1',
    subtotal: 0,
    discountAmount: 0,
    taxAmount: 0,
    total: 0,
  };
  const draw = () => buildDocumentPdf({ kind: 'QUOTATION', document: quotation, customer: customerA, settings, items: [] });

  const before = await draw();
  const save = await api('PUT', '/api/document-templates/QUOTATION', {
    body: { accentColor: '#FF0000', headerNote: 'Lead time: 5 working days.', showBankDetails: false },
  });
  assert.equal(save.status, 200);
  const after = await draw();

  assert.equal(after.subarray(0, 4).toString(), '%PDF');
  assert.ok(!before.equals(after), 'a custom accent must change the rendered PDF');
});
