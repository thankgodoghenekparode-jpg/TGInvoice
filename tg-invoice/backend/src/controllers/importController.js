import multer from 'multer';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import {
  IMPORT_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  assertImportType,
  planImport,
  commitImport,
  buildTemplateCsv,
} from '../services/importService.js';

/**
 * CSV / Excel import endpoints.
 *
 *   POST /api/imports/:type/preview   — parse + validate, no writes
 *   POST /api/imports/:type           — parse + validate + write
 *   GET  /api/imports/:type/template  — a fill-in CSV template
 *
 * Both uploads are multipart with a single `file` field.
 */

const ALLOWED_EXTENSIONS = ['csv', 'tsv', 'txt', 'xlsx', 'xlsm', 'xls'];

const extensionOf = (name = '') => (name.lastIndexOf('.') === -1 ? '' : name.slice(name.lastIndexOf('.') + 1).toLowerCase());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = extensionOf(file.originalname);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      const message = 'Choose a .csv, .xlsx or .xls file.';
      return cb(errors.badRequest(message, [{ path: 'file', message }]));
    }
    cb(null, true);
  },
});

export const importUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `This file is larger than ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.`
          : 'Could not read that file.';
      return next(errors.badRequest(message, [{ path: 'file', message }]));
    }
    if (err) return next(err);
    next();
  });
};

/* ── GET /api/imports/:type/template ──────────────────────────────── */

export const downloadTemplate = asyncHandler(async (req, res) => {
  const { type } = req.params;
  assertImportType(type);
  const csv = buildTemplateCsv(type);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tg-invoice-${type}-template.csv"`);
  res.send(csv);
});

/* ── POST /api/imports/:type/preview ──────────────────────────────── */

export const previewImport = asyncHandler(async (req, res) => {
  const { type } = req.params;
  assertImportType(type);
  if (!req.file) throw errors.badRequest('Choose a file to import.', [{ path: 'file', message: 'No file received.' }]);

  const plan = await planImport(req.tenant.id, type, req.file.buffer, req.file.originalname);

  // The preview is capped so a huge file never floods the response.
  const rows = plan.rows.slice(0, MAX_IMPORT_ROWS);
  ok(res, { ...plan, rows, truncated: plan.rows.length > rows.length }, { type, label: IMPORT_TYPES[type].label });
});

/* ── POST /api/imports/:type ──────────────────────────────────────── */

export const runImport = asyncHandler(async (req, res) => {
  const { type } = req.params;
  assertImportType(type);
  if (!req.file) throw errors.badRequest('Choose a file to import.', [{ path: 'file', message: 'No file received.' }]);

  const result = await commitImport(req.tenant.id, type, req.file.buffer, req.file.originalname);

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'IMPORT_RECORDS', type, {
    entityLabel: IMPORT_TYPES[type].label,
    description: `${req.user.name} imported ${result.created} new and updated ${result.updated} existing ${IMPORT_TYPES[type].label.toLowerCase()} (${result.skipped} skipped)`,
  });

  ok(res, result);
});
