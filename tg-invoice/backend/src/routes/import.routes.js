import { Router } from 'express';
import { importUpload, downloadTemplate, previewImport, runImport } from '../controllers/importController.js';

/* ── CSV / Excel import ───────────────────────────────────────────── */

export const importRouter = Router();

// /:type/template must be declared before the bare /:type handlers.
importRouter.get('/:type/template', downloadTemplate);
importRouter.post('/:type/preview', importUpload, previewImport);
importRouter.post('/:type', importUpload, runImport);
