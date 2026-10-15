import { prisma } from '../prisma.js';
import { errors } from '../utils/errors.js';

/**
 * Custom fields — tenant-defined extra attributes on customers and documents.
 *
 * Definitions live in CustomField (keyed per entity: CUSTOMER / QUOTATION /
 * INVOICE / RECEIPT / CREDIT_NOTE); each record's value lives in
 * CustomFieldValue. Values are validated here (typed, select-allow-listed) so
 * a bad value can never reach the database, and the PDF renderer reads only
 * the fields flagged `showOnDocument`.
 */

/** Entities that can carry custom fields (mirrors the UI). */
export const CUSTOM_FIELD_ENTITIES = ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT', 'CREDIT_NOTE'];

export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'];

export const ENTITY_LABELS = {
  CUSTOMER: 'Customer',
  QUOTATION: 'Quotation',
  INVOICE: 'Invoice',
  RECEIPT: 'Receipt',
  CREDIT_NOTE: 'Credit note',
};

export function assertEntity(entity) {
  if (!CUSTOM_FIELD_ENTITIES.includes(entity)) {
    throw errors.badRequest('Choose a valid record type.', [{ path: 'entity', message: 'Unknown record type.' }]);
  }
}

/** "Delivery Address" → "delivery_address"; always a safe identifier. */
export function slugifyKey(label = '') {
  const base = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (!base) return 'field';
  return /^[a-z]/.test(base) ? base : `f_${base}`;
}

/** Ensure the key is unique within (tenant, entity) by suffixing _2, _3 … */
export async function uniqueKey(tenantId, entity, base, excludeId = null) {
  let candidate = base;
  for (let n = 2; n < 200; n += 1) {
    const clash = await prisma.customField.findFirst({
      where: { tenantId, entity, key: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}_${n}`;
  }
  return `${base}_${Date.now()}`;
}

export function serializeField(field, value = null) {
  return {
    id: field.id,
    entity: field.entity,
    key: field.key,
    label: field.label,
    type: field.type,
    options: Array.isArray(field.options) ? field.options : [],
    required: field.required,
    showOnDocument: field.showOnDocument,
    position: field.position,
    value,
    createdAt: field.createdAt,
    updatedAt: field.updatedAt,
  };
}

/**
 * Validate + normalise one raw input against its definition.
 * @returns {{ value: string|null, error?: string }}
 */
export function coerceValue(field, raw) {
  if (raw === null || raw === undefined) return { value: null };
  const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (str === '') return { value: null };

  switch (field.type) {
    case 'NUMBER': {
      const n = Number(str);
      if (!Number.isFinite(n)) return { value: null, error: 'must be a number' };
      return { value: String(n) };
    }
    case 'DATE': {
      const d = new Date(str);
      if (Number.isNaN(d.getTime())) return { value: null, error: 'must be a valid date' };
      return { value: d.toISOString().slice(0, 10) };
    }
    case 'BOOLEAN': {
      const low = str.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(low)) return { value: 'true' };
      if (['false', '0', 'no', 'off'].includes(low)) return { value: 'false' };
      return { value: null, error: 'must be yes or no' };
    }
    case 'SELECT': {
      const opts = Array.isArray(field.options) ? field.options : [];
      const match = opts.find((o) => o === str) ?? opts.find((o) => String(o).toLowerCase() === str.toLowerCase());
      if (!match) return { value: null, error: opts.length ? `must be one of: ${opts.join(', ')}` : 'has no options configured' };
      return { value: String(match) };
    }
    default:
      return { value: str.slice(0, 2000) };
  }
}

export async function listFields(tenantId, entity) {
  const where = { tenantId, ...(entity ? { entity } : {}) };
  return prisma.customField.findMany({ where, orderBy: [{ entity: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] });
}

/** Field definitions for one record, each decorated with its current value. */
export async function loadFieldsWithValues(tenantId, entity, entityId) {
  const fields = await prisma.customField.findMany({
    where: { tenantId, entity },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  const values = entityId
    ? await prisma.customFieldValue.findMany({ where: { tenantId, entity, entityId } })
    : [];
  const byKey = new Map(values.map((v) => [v.fieldId, v.value]));
  return fields.map((f) => serializeField(f, byKey.get(f.id) ?? null));
}

/** Fields flagged for printing, with a non-empty value — for the PDF. */
export async function loadPrintableFields(tenantId, entity, entityId) {
  if (!tenantId || !entityId || !CUSTOM_FIELD_ENTITIES.includes(entity)) return [];
  const values = await prisma.customFieldValue.findMany({
    where: { tenantId, entity, entityId, field: { showOnDocument: true } },
    include: { field: true },
  });
  return values
    .filter((v) => v.value !== '' && v.value != null)
    .sort((a, b) => (a.field.position ?? 0) - (b.field.position ?? 0))
    .map((v) => ({ key: v.field.key, label: v.field.label, type: v.field.type, value: v.value }));
}

/**
 * Replace all values for one record. Definitions are the source of truth:
 * an empty value deletes the stored row, so cleared fields stay cleared.
 * Required fields must have a value.
 */
export async function saveValues(tenantId, entity, entityId, values = {}) {
  const fields = await prisma.customField.findMany({ where: { tenantId, entity } });

  const details = [];
  const plan = fields.map((field) => {
    const { value, error } = coerceValue(field, values?.[field.key]);
    if (error) details.push({ path: field.key, message: `“${field.label}” ${error}.` });
    else if (field.required && value === null) details.push({ path: field.key, message: `“${field.label}” is required.` });
    return { field, value };
  });
  if (details.length) throw errors.badRequest('Please check the highlighted fields.', details);

  await prisma.$transaction(
    plan.map(({ field, value }) => {
      if (value === null) {
        return prisma.customFieldValue.deleteMany({ where: { fieldId: field.id, entityId } });
      }
      return prisma.customFieldValue.upsert({
        where: { fieldId_entityId: { fieldId: field.id, entityId } },
        create: { tenantId, fieldId: field.id, entity, entityId, value },
        update: { value },
      });
    })
  );

  return loadFieldsWithValues(tenantId, entity, entityId);
}
