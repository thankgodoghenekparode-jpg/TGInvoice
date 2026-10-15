/**
 * Attachments — files stored against any document.
 *
 * The invariants that matter:
 *   - a file is only ever attached to a document that exists in the same tenant;
 *   - downloads are tenant-scoped and return the exact bytes stored;
 *   - deleting an attachment removes the row and the stored blob;
 *   - unsupported types and oversized files are rejected with a 400.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';
import app from '../src/app.js';
import { deleteFile } from '../src/services/storageService.js';

let server;
let base;
let tenantA;
let tenantB;
let tokenA;
let tokenB;
let customerA;
let invoiceA;

const authHeaders = (token, tenantId) => ({ Authorization: `Bearer ${token}`, 'X-Tenant-Id': tenantId });

async function jsonApi(method, path, { token = tokenA, tenantId = tenantA.id, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...authHeaders(token, tenantId), 'Content-Type': 'application/json' },
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

async function uploadFile({ fileName, content, mimeType, documentKind, documentId, token = tokenA, tenantId = tenantA.id }) {
  const fd = new FormData();
  fd.append('documentKind', documentKind);
  fd.append('documentId', documentId);
  fd.append('file', new Blob([content], { type: mimeType }), fileName);
  const res = await fetch(`${base}/api/attachments`, {
    method: 'POST',
    headers: authHeaders(token, tenantId), // fetch sets the multipart boundary
    body: fd,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

async function makeAccount(email, slug, name) {
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, emailVerified: true },
  });
  const tenant = await prisma.tenant.create({ data: { name, slug } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });
  await prisma.companySettings.create({ data: { tenantId: tenant.id, businessName: name, currency: 'NGN', currencySymbol: '₦' } });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ChangeMe123!' }),
  });
  const loginJson = await login.json();
  assert.equal(login.status, 200, `login for ${email} must succeed`);
  return { user, tenant, token: loginJson.data.accessToken };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const a = await makeAccount('attach-a@test.local', 'attach-tenant-a', 'Attach Co A');
  tenantA = a.tenant;
  tokenA = a.token;
  const b = await makeAccount('attach-b@test.local', 'attach-tenant-b', 'Attach Co B');
  tenantB = b.tenant;
  tokenB = b.token;

  customerA = await prisma.customer.create({
    data: { tenantId: tenantA.id, customerCode: 'CUS-00001', name: 'Ada Obi' },
  });
  invoiceA = await prisma.invoice.create({
    data: {
      tenantId: tenantA.id,
      customerId: customerA.id,
      invoiceNumber: 'INV-00001',
      status: 'SENT',
      subtotal: 1000,
      total: 1000,
      balanceDue: 1000,
      items: { create: [{ description: 'Work', quantity: 1, unitPrice: 1000, amount: 1000 }] },
    },
  });
});

after(async () => {
  // Remove stored blobs for both tenants before dropping the rows.
  const rows = await prisma.attachment.findMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await Promise.all(rows.map((r) => deleteFile(r.key).catch(() => {})));

  await prisma.attachment.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.invoice.deleteMany({ where: { tenantId: tenantA.id } });
  await prisma.customer.deleteMany({ where: { tenantId: tenantA.id } });
  await prisma.companySettings.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.tenant.deleteMany({ where: { slug: { in: ['attach-tenant-a', 'attach-tenant-b'] } } });
  await prisma.user.deleteMany({ where: { email: { in: ['attach-a@test.local', 'attach-b@test.local'] } } });
  await prisma.$disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
});

/* ── upload / list ────────────────────────────────────────────────── */

test('a file can be uploaded to a document and listed', async () => {
  const bytes = 'Hello attachment world';
  const { status, json } = await uploadFile({
    fileName: 'contract.txt',
    content: bytes,
    mimeType: 'text/plain',
    documentKind: 'CUSTOMER',
    documentId: customerA.id,
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.data.fileName, 'contract.txt');
  assert.equal(json.data.size, Buffer.byteLength(bytes));
  assert.equal(json.data.documentKind, 'CUSTOMER');
  assert.equal(json.data.uploadedBy.name, 'Attach Co A');
  assert.match(json.data.url, /^\/api\/attachments\/.+\/download$/);

  const list = await jsonApi('GET', `/api/attachments?documentKind=CUSTOMER&documentId=${customerA.id}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 1);
  assert.equal(list.json.data[0].fileName, 'contract.txt');
});

test('uploads to an invoice are scoped to that document', async () => {
  const { status } = await uploadFile({
    fileName: 'po.pdf',
    content: '%PDF-1.4 fake',
    mimeType: 'application/pdf',
    documentKind: 'INVOICE',
    documentId: invoiceA.id,
  });
  assert.equal(status, 201);

  const invoiceList = await jsonApi('GET', `/api/attachments?documentKind=INVOICE&documentId=${invoiceA.id}`);
  assert.equal(invoiceList.json.data.length, 1);

  const customerList = await jsonApi('GET', `/api/attachments?documentKind=CUSTOMER&documentId=${customerA.id}`);
  assert.equal(customerList.json.data.length, 1, 'invoice attachment must not leak into the customer list');
});

test('path separators in the file name are stripped', async () => {
  const { status, json } = await uploadFile({
    fileName: '..\\..\\evil.txt',
    content: 'x',
    mimeType: 'text/plain',
    documentKind: 'CUSTOMER',
    documentId: customerA.id,
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.data.fileName, 'evil.txt');
});

/* ── validation ───────────────────────────────────────────────────── */

test('an unsupported file type is rejected', async () => {
  const { status, json } = await uploadFile({
    fileName: 'malware.exe',
    content: 'MZ',
    mimeType: 'application/x-msdownload',
    documentKind: 'CUSTOMER',
    documentId: customerA.id,
  });
  assert.equal(status, 400);
  assert.match(json.error.message, /file type/i);
});

test('attaching to a document in another tenant is rejected', async () => {
  const { status } = await uploadFile({
    fileName: 'notes.txt',
    content: 'hi',
    mimeType: 'text/plain',
    documentKind: 'CUSTOMER',
    documentId: customerA.id,
    token: tokenB,
    tenantId: tenantB.id,
  });
  assert.equal(status, 400);
});

test('a request with no file is rejected', async () => {
  const fd = new FormData();
  fd.append('documentKind', 'CUSTOMER');
  fd.append('documentId', customerA.id);
  const res = await fetch(`${base}/api/attachments`, {
    method: 'POST',
    headers: authHeaders(tokenA, tenantA.id),
    body: fd,
  });
  assert.equal(res.status, 400);
});

test('a file larger than the limit is rejected', async () => {
  const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 1); // 10 MB + 1 KB
  const { status, json } = await uploadFile({
    fileName: 'big.pdf',
    content: big,
    mimeType: 'application/pdf',
    documentKind: 'CUSTOMER',
    documentId: customerA.id,
  });
  assert.equal(status, 400);
  assert.match(json.error.message, /too large/i);
});

/* ── download / isolation ─────────────────────────────────────────── */

test('the stored file downloads with its original bytes', async () => {
  const list = await jsonApi('GET', `/api/attachments?documentKind=CUSTOMER&documentId=${customerA.id}`);
  const attachment = list.json.data.find((a) => a.fileName === 'contract.txt');
  assert.ok(attachment, 'contract.txt must be listed');

  const res = await fetch(`${base}/api/attachments/${attachment.id}/download`, {
    headers: authHeaders(tokenA, tenantA.id),
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'Hello attachment world');
  assert.match(res.headers.get('content-disposition') || '', /contract\.txt/);
});

test('another tenant cannot download the attachment', async () => {
  const list = await jsonApi('GET', `/api/attachments?documentKind=CUSTOMER&documentId=${customerA.id}`);
  const attachment = list.json.data[0];
  const res = await fetch(`${base}/api/attachments/${attachment.id}/download`, {
    headers: authHeaders(tokenB, tenantB.id),
  });
  assert.equal(res.status, 404);
});

test('another tenant sees no attachments for the document id', async () => {
  const list = await jsonApi('GET', `/api/attachments?documentKind=CUSTOMER&documentId=${customerA.id}`, {
    token: tokenB,
    tenantId: tenantB.id,
  });
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 0);
});

/* ── delete ───────────────────────────────────────────────────────── */

test('an attachment can be deleted, and its blob is gone', async () => {
  const created = await uploadFile({
    fileName: 'delete-me.txt',
    content: 'temporary',
    mimeType: 'text/plain',
    documentKind: 'CUSTOMER',
    documentId: customerA.id,
  });
  assert.equal(created.status, 201);
  const id = created.json.data.id;

  const del = await jsonApi('DELETE', `/api/attachments/${id}`);
  assert.equal(del.status, 200);

  const gone = await fetch(`${base}/api/attachments/${id}/download`, { headers: authHeaders(tokenA, tenantA.id) });
  assert.equal(gone.status, 404);
});
