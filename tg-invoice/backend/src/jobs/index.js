import systemHandlers, { periodicTasks as systemTasks } from './system.js';
import documentHandlers, { periodicTasks as documentTasks } from './documents.js';
import billingHandlers, { periodicTasks as billingTasks } from './billing.js';
import growthHandlers, { periodicTasks as growthTasks } from './growth.js';
import paymentHandlers, { periodicTasks as paymentTasks } from './payments.js';

/**
 * Job handler registry. Each feature module exports:
 *   - default:  { '<type>': async (payload, job) => {} }
 *   - periodicTasks: [ { type, everyMs, payload } ] — scheduled by the worker
 *
 * Keep every handler idempotent: a job can be retried after a crash.
 */

const handlers = new Map();

function register(map) {
  for (const [type, fn] of Object.entries(map)) handlers.set(type, fn);
}

register(systemHandlers);
register(documentHandlers);
register(billingHandlers);
register(growthHandlers);
register(paymentHandlers);
// Feature modules register here as they land.

export function getHandler(type) {
  return handlers.get(type);
}

export function jobTypes() {
  return [...handlers.keys()];
}

export const periodicTasks = [...systemTasks, ...documentTasks, ...billingTasks, ...growthTasks, ...paymentTasks];
