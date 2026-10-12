import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';

/**
 * Tenant-specific document numbering (INV-00001, QT-00001, REC-00001).
 *
 * Two tenants may both issue QT-00001 — the sequence row is keyed by
 * (tenantId, kind). Within a tenant, numbers never repeat:
 *  - the counter is incremented inside a Serializable transaction, and
 *  - a unique constraint on (tenantId, <kind>Number) is the final guard;
 *    collisions retry with the next number.
 *
 * Numbers are NEVER generated on the frontend.
 */

const PAD = 5;
const MAX_ATTEMPTS = 5;

async function nextSequenceNumber(tx, tenantId, kind) {
  const seq = await tx.documentSequence.findUnique({
    where: { tenantId_kind: { tenantId, kind } },
  });

  if (!seq) {
    // First document of this kind for this tenant.
    try {
      await tx.documentSequence.create({ data: { tenantId, kind, prefix: defaultPrefix(kind), next: 2 } });
      return 1;
    } catch (err) {
      if (err?.code === 'P2002') {
        const again = await tx.documentSequence.findUnique({
          where: { tenantId_kind: { tenantId, kind } },
        });
        const value = again.next;
        await tx.documentSequence.update({
          where: { id: again.id },
          data: { next: { increment: 1 } },
        });
        return value;
      }
      throw err;
    }
  }

  const value = seq.next;
  await tx.documentSequence.update({
    where: { id: seq.id },
    data: { next: { increment: 1 } },
  });
  return value;
}

function defaultPrefix(kind) {
  if (kind === 'QUOTATION') return 'QT';
  if (kind === 'RECEIPT') return 'REC';
  if (kind === 'CUSTOMER') return 'CUS';
  return 'INV';
}

function currentPrefix(kind, settings) {
  if (kind === 'CUSTOMER') return 'CUS'; // customer codes are always CUS-00001
  if (!settings) return defaultPrefix(kind);
  if (kind === 'QUOTATION') return settings.quotationPrefix || 'QT';
  if (kind === 'RECEIPT') return settings.receiptPrefix || 'REC';
  return settings.invoicePrefix || 'INV';
}

export function formatNumber(prefix, n) {
  return `${prefix}-${String(n).padStart(PAD, '0')}`;
}

/**
 * Allocate the next document number for a tenant.
 *
 * Works in both contexts:
 *  - with the root Prisma client → runs its own Serializable transaction;
 *  - with an open transaction client (tx.$transaction is absent) → increments
 *    inside the caller's transaction, so multi-write operations (convert,
 *    record payment + receipt) stay atomic.
 *
 * @param {import('@prisma/client').PrismaClient | *} db
 */
export async function allocateDocumentNumber(db, tenantId, kind, settings = null) {
  const prefix = currentPrefix(kind, settings);
  const inTransaction = typeof db.$transaction !== 'function';

  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const n = inTransaction
        ? await nextSequenceNumber(db, tenantId, kind)
        : await db.$transaction((tx) => nextSequenceNumber(tx, tenantId, kind), { isolationLevel: 'Serializable' });
      const number = formatNumber(prefix, n);

      // Unique (tenantId, number) constraint is the last line of defence
      // (e.g. prefix changed mid-flight). Retry allocates the next value.
      const modelKey =
        kind === 'QUOTATION' ? 'quotation' : kind === 'RECEIPT' ? 'receipt' : kind === 'CUSTOMER' ? 'customer' : 'invoice';
      const numberField =
        kind === 'QUOTATION' ? 'quotationNumber' : kind === 'RECEIPT' ? 'receiptNumber' : kind === 'CUSTOMER' ? 'customerCode' : 'invoiceNumber';
      const exists = await db[modelKey].findFirst({
        where: { tenantId, [numberField]: number },
        select: { id: true },
      });
      if (!exists) return number;
      lastError = new Error('collision');
    } catch (err) {
      lastError = err;
      // Serializable conflict / unique violation → brief backoff, retry.
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
  console.error('[sequence-failed]', kind, lastError?.message);
  throw errors.internal('Unable to generate a document number. Please try again.');
}

/** Seed-friendly: initialise sequence rows for a new tenant. */
export async function initSequences(tenantId) {
  const rows = ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT'].map((kind) => ({
    tenantId,
    kind,
    prefix: defaultPrefix(kind),
    next: 1,
  }));
  await prisma.documentSequence.createMany({ data: rows, skipDuplicates: true });
}

export default allocateDocumentNumber;
