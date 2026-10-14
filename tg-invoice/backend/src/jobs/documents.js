import { autoDeliver } from '../services/documentDeliveryService.js';

/**
 * Document delivery jobs. Enqueued when a document is marked "sent" so the
 * push happens off the request path and retries if a provider is down.
 */

export default {
  'document.autoDeliver': async ({ kind, documentId, tenantId }) => {
    if (!kind || !documentId || !tenantId) throw new Error('kind, documentId and tenantId are required');
    const results = await autoDeliver(kind, documentId, tenantId);
    if (results?.length) {
      const summary = results.map((r) => `${r.channel}=${r.status}`).join(' ');
      console.log(`[job] auto-delivered ${kind} ${documentId}: ${summary}`);
    }
  },
};

export const periodicTasks = [];
