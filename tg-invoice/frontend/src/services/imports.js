import api from './api.js';

/**
 * CSV / Excel import.
 *
 * `previewImport` parses + validates without writing, `runImport` performs the
 * write. The template is fetched as an authenticated blob so the Authorization
 * and tenant headers travel with it.
 */

export const IMPORT_TYPES = [
  {
    value: 'customers',
    label: 'Customers',
    description: 'Name, company, contact details, address, tax ID and notes.',
  },
  {
    value: 'products',
    label: 'Products & services',
    description: 'Name, description, category, unit, price, tax rate and active flag.',
  },
];

export const previewImport = (type, file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/imports/${type}/preview`, form).then((r) => r.data.data);
};

export const runImport = (type, file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/imports/${type}`, form).then((r) => r.data.data);
};

/** Download the fill-in CSV template for an import type. */
export async function downloadTemplate(type) {
  const res = await api.get(`/imports/${type}/template`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tg-invoice-${type}-template.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default { IMPORT_TYPES, previewImport, runImport, downloadTemplate };
