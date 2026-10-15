import { api } from './api';

/**
 * Outbound delivery (WhatsApp Cloud API / SMS / email) and the delivery log.
 * All calls are tenant-scoped by the api client's X-Tenant-Id header.
 */

const KIND_PLURAL = { QUOTATION: 'quotations', INVOICE: 'invoices', RECEIPT: 'receipts', CREDIT_NOTE: 'credit-notes' };

/** Which providers this deployment has configured (npm run worker env). */
export const getMessagingStatus = () => api.get('/messages/status').then((res) => res.data.data);

export const listMessageLogs = (params) => api.get('/messages', { params }).then((res) => res.data);

/**
 * Send a document over the chosen channels.
 * @param {'INVOICE'|'QUOTATION'|'RECEIPT'} kind
 * @param {{ channels: string[], to?: string, message?: string, subject?: string }} payload
 */
export const deliverDocument = (kind, id, payload) =>
  api.post(`/${KIND_PLURAL[kind]}/${id}/deliver`, payload).then((res) => res.data.data);

export default { getMessagingStatus, listMessageLogs, deliverDocument };
