import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/errorHandler.js';
import {
  customFieldSchema,
  customFieldUpdateSchema,
  customFieldValuesSchema,
  documentTemplateSchema,
} from '../validators/customizationValidators.js';
import * as fields from '../controllers/customFieldController.js';
import * as templates from '../controllers/documentTemplateController.js';

/* ── Custom fields ────────────────────────────────────────────────── */

export const customFieldRouter = Router();
// /values must be matched before /:id.
customFieldRouter.get('/values', fields.getValues);
customFieldRouter.put('/values', validate(customFieldValuesSchema), fields.saveValues);
customFieldRouter.get('/', fields.listFields);
customFieldRouter.post('/', requireAdmin, validate(customFieldSchema), fields.createField);
customFieldRouter.patch('/:id', requireAdmin, validate(customFieldUpdateSchema), fields.updateField);
customFieldRouter.delete('/:id', requireAdmin, fields.deleteField);

/* ── Document templates ───────────────────────────────────────────── */

export const documentTemplateRouter = Router();
documentTemplateRouter.get('/', templates.list);
documentTemplateRouter.get('/:kind', templates.get);
documentTemplateRouter.put('/:kind', requireAdmin, validate(documentTemplateSchema), templates.save);
documentTemplateRouter.delete('/:kind', requireAdmin, templates.reset);
