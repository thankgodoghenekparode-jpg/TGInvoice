import { enqueue } from './jobService.js';
import { periodicTasks } from '../jobs/index.js';

/**
 * In-process scheduler — replaces an external cron. The worker ticks every
 * `intervalMs`, computes a time bucket per periodic task, and enqueues the job
 * with `dedupeKey = periodic:<type>:<bucket>`. Because dedupeKey is unique, N
 * worker instances ticking simultaneously produce exactly one job per bucket.
 */

let timer = null;

const bucket = (now, everyMs) => Math.floor(now.getTime() / everyMs);

export async function runDuePeriodicTasks(now = new Date()) {
  let scheduled = 0;
  for (const task of periodicTasks) {
    const everyMs = task.everyMs || 60_000;
    const created = await enqueue(task.type, task.payload || {}, {
      dedupeKey: `periodic:${task.type}:${bucket(now, everyMs)}`,
      runAt: now,
    });
    if (created) scheduled += 1;
  }
  return scheduled;
}

export function startScheduler({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  const tick = () => {
    runDuePeriodicTasks().catch((err) => console.error('[scheduler]', err?.message));
  };
  tick();
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  console.log(`[scheduler] started — ${periodicTasks.length} periodic task(s), every ${intervalMs}ms`);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
