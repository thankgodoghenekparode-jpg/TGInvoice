import { purgeFinishedJobs } from '../services/jobService.js';

/**
 * Housekeeping handlers. Every handler is `(payload, job) => Promise<void>`.
 * Throwing marks the job for retry (see jobService.failJob).
 */

export default {
  'system.cleanup': async (payload = {}) => {
    const removed = await purgeFinishedJobs(payload.olderThanDays ?? 7);
    console.log(`[job] cleanup: removed ${removed} finished jobs`);
  },

  'system.ping': async (payload = {}) => {
    console.log('[job] ping', payload ?? {});
  },
};

/** Periodic tasks the scheduler registers. `type` must have a handler. */
export const periodicTasks = [
  { type: 'system.cleanup', everyMs: 60 * 60 * 1000, payload: { olderThanDays: 7 } },
];
