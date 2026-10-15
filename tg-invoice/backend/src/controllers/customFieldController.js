import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import { logAudit } from '../services/auditService.js';
import {
  CUSTOM_FIELD_ENTITIES,
  ENTITY_LABELS,
  assertEntity,
  slugifyKey,
  uniqueKey,
  serializeField,
  listFields as listFieldDefs,
  loadFieldsWithValues,
  saveValues as persistValues,
} from '../services/customFieldService.js';
import { assertDocumentExists } from '../services/attachmentService.js';

/**
 * Custom fields — definitions (owner/admin) and per-record values (any member).
 * Definitions are always queried with tenantId: req.tenant.id.
 */

/* ── GET /api/custom-fields?entity=INVOICE ────────────────────────── */

export const listFields = asyncHandler(async (req, res) => {
  const { entity } = req.query;
  if (entity && !CUSTOM_FIELD_ENTITIES.includes(entity)) {
    throw errors.badRequest('Unknown record type.');
  }
  const fields = await listFieldDefs(req.tenant.id, entity);
  ok(res, fields.map((f) => serializeField(f)), { entities: ENTITY_LABELS });
});

/* ── POST /api/custom-fields ──────────────────────────────────────── */

export const createField = asyncHandler(async (req, res) => {
  const body = req.validatedBody;
  assertEntity(body.entity);

  const base = slugifyKey(body.key || body.label);
  const key = await uniqueKey(req.tenant.id, body.entity, base);

  const field = await prisma.customField.create({
    data: {
      tenantId: req.tenant.id,
      entity: body.entity,
      key,
      label: body.label,
      type: body.type,
      options: Array.isArray(body.options) ? body.options : null,
      required: body.required ?? false,
      showOnDocument: body.showOnDocument ?? false,
      position: body.position ?? 0,
    },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'CREATE_CUSTOM_FIELD', 'custom_field', {
    entityId: field.id,
    entityLabel: field.label,
    description: `${req.user.name} added the custom field “${field.label}” to ${ENTITY_LABELS[field.entity]}`,
  });

  created(res, serializeField(field));
});

/* ── PATCH /api/custom-fields/:id ─────────────────────────────────── */

export const updateField = asyncHandler(async (req, res) => {
  const existing = await prisma.customField.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Custom field not found.');

  const body = req.validatedBody;
  const type = body.type ?? existing.type;
  const options = body.options !== undefined ? body.options : existing.options;
  if (type === 'SELECT' && (!Array.isArray(options) || options.length === 0)) {
    throw errors.badRequest('Please check the highlighted fields.', [{ path: 'options', message: 'Add at least one option.' }]);
  }

  // entity never changes — values are keyed by (field, entityId) and would be orphaned.
  let key = existing.key;
  if (body.key && slugifyKey(body.key) !== existing.key) {
    key = await uniqueKey(req.tenant.id, existing.entity, slugifyKey(body.key), existing.id);
  }

  const field = await prisma.customField.update({
    where: { id: existing.id },
    data: {
      key,
      label: body.label ?? existing.label,
      type,
      options: Array.isArray(options) ? options : null,
      required: body.required ?? existing.required,
      showOnDocument: body.showOnDocument ?? existing.showOnDocument,
      position: body.position ?? existing.position,
    },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_CUSTOM_FIELD', 'custom_field', {
    entityId: field.id,
    entityLabel: field.label,
    description: `${req.user.name} updated the custom field “${field.label}”`,
  });

  ok(res, serializeField(field));
});

/* ── DELETE /api/custom-fields/:id ────────────────────────────────── */

export const deleteField = asyncHandler(async (req, res) => {
  const existing = await prisma.customField.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw errors.notFound('Custom field not found.');

  // Values cascade with the definition.
  await prisma.customField.delete({ where: { id: existing.id } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'DELETE_CUSTOM_FIELD', 'custom_field', {
    entityId: existing.id,
    entityLabel: existing.label,
    description: `${req.user.name} removed the custom field “${existing.label}”`,
  });

  ok(res, { message: 'Custom field removed.' });
});

/* ── GET /api/custom-fields/values?entity=&entityId= ──────────────── */

export const getValues = asyncHandler(async (req, res) => {
  const { entity, entityId } = req.query;
  if (!CUSTOM_FIELD_ENTITIES.includes(entity)) throw errors.badRequest('Choose a valid record type.');
  if (!entityId) throw errors.badRequest('Choose the record whose values you want.');
  await assertDocumentExists(entity, entityId, req.tenant.id);

  const fields = await loadFieldsWithValues(req.tenant.id, entity, entityId);
  ok(res, { entity, entityId, fields });
});

/* ── PUT /api/custom-fields/values ────────────────────────────────── */

export const saveValues = asyncHandler(async (req, res) => {
  const { entity, entityId, values } = req.validatedBody;
  await assertDocumentExists(entity, entityId, req.tenant.id);

  const fields = await persistValues(req.tenant.id, entity, entityId, values);
  ok(res, { entity, entityId, fields });
});
