import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';

/**
 * Attachments — files (contracts, PO scans, receipts photos…) stored against
 * any document. `documentId` is polymorphic, so the owning row is verified
 * here (tenant-scoped) before every write/read; the DB only indexes it.
 */

/** DocumentKind → Prisma model delegate name. */
export const DOCUMENT_MODELS = {
  CUSTOMER: 'customer',
  QUOTATION: 'quotation',
  INVOICE: 'invoice',
  RECEIPT: 'receipt',
  CREDIT_NOTE: 'creditNote',
  REFUND: 'refund',
};

export const DOCUMENT_LABELS = {
  CUSTOMER: 'Customer',
  QUOTATION: 'Quotation',
  INVOICE: 'Invoice',
  RECEIPT: 'Receipt',
  CREDIT_NOTE: 'Credit note',
  REFUND: 'Refund',
};

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Extensions we accept, mapped to a friendly rejection message. */
export const ALLOWED_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip',
];

export const MAX_ATTACHMENTS_PER_DOCUMENT = 20;

/** Verify the target document exists in this tenant, or throw the standard errors. */
export async function assertDocumentExists(kind, documentId, tenantId) {
  const model = DOCUMENT_MODELS[kind];
  if (!model) {
    throw errors.badRequest('Unsupported document type.', [{ path: 'documentKind', message: 'Unknown document type.' }]);
  }
  if (!documentId) {
    throw errors.badRequest('A document is required.', [{ path: 'documentId', message: 'Choose the document to attach to.' }]);
  }
  const found = await prisma[model].findFirst({ where: { id: documentId, tenantId }, select: { id: true } });
  if (!found) {
    throw errors.badRequest(`${DOCUMENT_LABELS[kind]} not found in this business.`, [
      { path: 'documentId', message: 'Document not found in this business.' },
    ]);
  }
  return found;
}

/** Lower-cased extension without the dot, e.g. "invoice.PDF" → "pdf". */
export function extensionOf(fileName = '') {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** Keep only a safe, human-readable basename (no path separators / control chars). */
export function safeFileName(fileName = '') {
  const base = String(fileName).split(/[\\/]/).pop() || 'file';
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 200) || 'file';
}

export function serializeAttachment(a) {
  return {
    id: a.id,
    documentKind: a.documentKind,
    documentId: a.documentId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    size: a.size,
    createdAt: a.createdAt,
    uploadedBy: a.uploadedBy ? { id: a.uploadedBy.id, name: a.uploadedBy.name } : null,
    url: `/api/attachments/${a.id}/download`,
  };
}

export default {
  DOCUMENT_MODELS,
  DOCUMENT_LABELS,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_EXTENSIONS,
  MAX_ATTACHMENTS_PER_DOCUMENT,
  assertDocumentExists,
  extensionOf,
  safeFileName,
  serializeAttachment,
};
