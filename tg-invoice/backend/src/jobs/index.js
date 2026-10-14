import systemHandlers, { periodicTasks as systemTasks } from './system.js';

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
// Feature modules register here as they land:
//   import recurringHandlers, { periodicTasks as recurringTasks } from './recurring.js';
//   import reminderHandlers,  { periodicTasks as reminderTasks }  from './reminders.js';

export function getHandler(type) {
  return handlers.get(type);
}

export function jobTypes() {
  return [...handlers.keys()];
}

export const periodicTasks = [...systemTasks /* , ...recurringTasks, ...reminderTasks */];
