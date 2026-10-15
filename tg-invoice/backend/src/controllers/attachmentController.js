import multer from 'multer';
import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import { saveFile, deleteFile, readFile } from '../services/storageService.js';
import {
  DOCUMENT_MODELS,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_EXTENSIONS,
  MAX_ATTACHMENTS_PER_DOCUMENT,
  assertDocumentExists,
  extensionOf,
  safeFileName,
  serializeAttachment,
} from '../services/attachmentService.js';

/**
 * Attachments — upload/list/download/delete files against any document.
 * Files are stored through the storage abstraction; only the key is persisted.
 */

const INCLUDE = { uploadedBy: { select: { id: true, name: true } } };

/* ── multer: in-memory, 10 MB, extension-checked ──────────────────── */

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = extensionOf(file.originalname);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(
        errors.badRequest(`That file type isn't supported. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`, [
          { path: 'file', message: 'Unsupported file type.' },
        ])
      );
    }
    cb(null, true);
  },
}).single('file');

/** Wrap multer so its errors become friendly 400s (not the logo 2 MB message). */
export const uploadMiddleware = (req, res, next) =>
  uploader(req, res, (err) => {
    if (err?.name === 'MulterError') {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `That file is too large — the maximum is ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`
          : 'Upload failed. Please try again.';
      return next(errors.badRequest(message, [{ path: 'file', message }]));
    }
    if (err) return next(err);
    next();
  });

/* ── GET /api/attachments?documentKind=&documentId= ───────────────── */

export const listAttachments = asyncHandler(async (req, res) => {
  const { documentKind, documentId } = req.query;
  if (!DOCUMENT_MODELS[documentKind] || !documentId) {
    throw errors.badRequest('Specify a document to list its attachments.');
  }

  const rows = await prisma.attachment.findMany({
    where: { tenantId: req.tenant.id, documentKind, documentId },
    include: INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  ok(res, rows.map(serializeAttachment));
});

/* ── POST /api/attachments (multipart: file, documentKind, documentId) */

export const createAttachment = asyncHandler(async (req, res) => {
  const { documentKind, documentId } = req.body || {};
  if (!req.file) throw errors.badRequest('Choose a file to upload.', [{ path: 'file', message: 'No file received.' }]);

  await assertDocumentExists(documentKind, documentId, req.tenant.id);

  const existing = await prisma.attachment.count({ where: { tenantId: req.tenant.id, documentKind, documentId } });
  if (existing >= MAX_ATTACHMENTS_PER_DOCUMENT) {
    throw errors.badRequest(`You can attach up to ${MAX_ATTACHMENTS_PER_DOCUMENT} files to one document.`);
  }

  const fileName = safeFileName(req.file.originalname);
  const ext = extensionOf(fileName) || 'bin';
  const key = await saveFile(req.file.buffer, { folder: `attachments/${req.tenant.id}`, ext });

  let attachment;
  try {
    attachment = await prisma.attachment.create({
      data: {
        tenantId: req.tenant.id,
        documentKind,
        documentId,
        fileName,
        mimeType: req.file.mimetype || 'application/octet-stream',
        size: req.file.size,
        key,
        uploadedById: req.user.id,
      },
      include: INCLUDE,
    });
  } catch (err) {
    // Never leave an orphaned blob behind if the row could not be written.
    await deleteFile(key).catch(() => {});
    throw err;
  }

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPLOAD_ATTACHMENT', 'attachment', {
    entityId: attachment.id,
    entityLabel: fileName,
    description: `${req.user.name} attached ${fileName} to a ${documentKind.toLowerCase().replace('_', ' ')}`,
  });

  created(res, serializeAttachment(attachment));
});

/* ── GET /api/attachments/:id/download ────────────────────────────── */

export const downloadAttachment = asyncHandler(async (req, res) => {
  const attachment = await prisma.attachment.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
  });
  if (!attachment) throw errors.notFound('Attachment not found.');

  let buffer;
  try {
    buffer = await readFile(attachment.key);
  } catch {
    throw errors.notFound('The stored file could not be found.');
  }

  const ascii = attachment.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.send(buffer);
});

/* ── DELETE /api/attachments/:id ──────────────────────────────────── */

export const deleteAttachment = asyncHandler(async (req, res) => {
  const attachment = await prisma.attachment.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
  });
  if (!attachment) throw errors.notFound('Attachment not found.');

  await prisma.attachment.delete({ where: { id: attachment.id } });
  await deleteFile(attachment.key).catch(() => {});

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_ATTACHMENT', 'attachment', {
    entityId: attachment.id,
    entityLabel: attachment.fileName,
    description: `${req.user.name} removed attachment ${attachment.fileName}`,
  });

  ok(res, { message: 'Attachment deleted.' });
});

export default {
  uploadMiddleware,
  listAttachments,
  createAttachment,
  downloadAttachment,
  deleteAttachment,
};
