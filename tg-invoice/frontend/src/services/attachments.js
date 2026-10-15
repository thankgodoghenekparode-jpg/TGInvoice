import api from './api.js';

/**
 * Files attached to any document (invoice, quotation, receipt, credit note,
 * customer…). Uploads are multipart; downloads go through the authenticated
 * blob helper in services/files.js.
 */

export const attachmentApi = {
  list: (documentKind, documentId) =>
    api.get('/attachments', { params: { documentKind, documentId } }).then((r) => r.data.data),

  upload: (documentKind, documentId, file) => {
    const form = new FormData();
    form.append('documentKind', documentKind);
    form.append('documentId', documentId);
    form.append('file', file);
    return api.post('/attachments', form).then((r) => r.data.data);
  },

  remove: (id) => api.delete(`/attachments/${id}`).then((r) => r.data),
};

export default attachmentApi;
