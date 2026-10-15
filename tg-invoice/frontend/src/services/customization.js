import api from './api.js';

/**
 * Custom fields + document templates — the tenant's own extra attributes and
 * PDF chrome. Values are typed on the server; the UI mirrors the types.
 */

export const ENTITY_LABELS = {
  CUSTOMER: 'Customers',
  QUOTATION: 'Quotations',
  INVOICE: 'Invoices',
  RECEIPT: 'Receipts',
  CREDIT_NOTE: 'Credit notes',
};

export const ENTITY_SINGULAR = {
  CUSTOMER: 'Customer',
  QUOTATION: 'Quotation',
  INVOICE: 'Invoice',
  RECEIPT: 'Receipt',
  CREDIT_NOTE: 'Credit note',
};

export const ENTITIES = Object.keys(ENTITY_LABELS);

export const FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'SELECT', label: 'Choice list' },
  { value: 'BOOLEAN', label: 'Yes / no' },
];

export const TYPE_LABELS = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label]));

export const customFieldApi = {
  list: (entity) => api.get('/custom-fields', { params: entity ? { entity } : {} }).then((r) => r.data.data),
  create: (body) => api.post('/custom-fields', body).then((r) => r.data.data),
  update: (id, body) => api.patch(`/custom-fields/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/custom-fields/${id}`).then((r) => r.data),
  values: (entity, entityId) =>
    api.get('/custom-fields/values', { params: { entity, entityId } }).then((r) => r.data.data),
  saveValues: (body) => api.put('/custom-fields/values', body).then((r) => r.data.data),
};

export const TEMPLATE_KINDS = [
  { value: 'INVOICE', label: 'Invoices' },
  { value: 'QUOTATION', label: 'Quotations' },
  { value: 'RECEIPT', label: 'Receipts' },
  { value: 'CREDIT_NOTE', label: 'Credit notes' },
];

export const templateApi = {
  list: () => api.get('/document-templates').then((r) => r.data.data),
  get: (kind) => api.get(`/document-templates/${kind}`).then((r) => r.data.data),
  save: (kind, body) => api.put(`/document-templates/${kind}`, body).then((r) => r.data.data),
  reset: (kind) => api.delete(`/document-templates/${kind}`).then((r) => r.data.data),
};

/** Display a stored value for read modes. */
export function displayValue(field, value) {
  if (value == null || value === '') return '—';
  if (field.type === 'BOOLEAN') return value === 'true' ? 'Yes' : 'No';
  return String(value);
}
