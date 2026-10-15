import api from './api.js';

/** Credit notes (customer credits) and refunds (cash paid back). */

export const creditNoteApi = {
  list: (params) => api.get('/credit-notes', { params }).then((r) => r.data),
  get: (id) => api.get(`/credit-notes/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/credit-notes', body).then((r) => r.data.data),
  update: (id, body) => api.put(`/credit-notes/${id}`, body).then((r) => r.data.data),
  remove: (id) => api.delete(`/credit-notes/${id}`).then((r) => r.data),
  issue: (id) => api.post(`/credit-notes/${id}/issue`).then((r) => r.data.data),
  void: (id, reason) => api.post(`/credit-notes/${id}/void`, { reason }).then((r) => r.data.data),
  apply: (id, body) => api.post(`/credit-notes/${id}/apply`, body).then((r) => r.data.data),
};

export const refundApi = {
  list: (params) => api.get('/refunds', { params }).then((r) => r.data),
  get: (id) => api.get(`/refunds/${id}`).then((r) => r.data.data),
  create: (body) => api.post('/refunds', body).then((r) => r.data.data),
  void: (id, reason) => api.post(`/refunds/${id}/void`, { reason }).then((r) => r.data.data),
};

export const CREDIT_NOTE_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'VOID', label: 'Void' },
];

export const REFUND_STATUS_OPTIONS = [
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'VOID', label: 'Void' },
];

export default { creditNoteApi, refundApi };
