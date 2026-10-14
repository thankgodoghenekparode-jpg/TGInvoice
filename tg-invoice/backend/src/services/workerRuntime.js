import config from '../config.js';
import { claimNextJob, completeJob, failJob, requeueStaleJobs } from './jobService.js';
import { getHandler, jobTypes } from '../jobs/index.js';
import { startScheduler, stopScheduler } from './schedulerService.js';

/**
 * Worker runtime: claim → run handler → complete/fail, then sleep when idle.
 * Runs either in its own process (`npm run worker`, the production shape) or
 * inline in the API process (INLINE_WORKER=true, for dev / single instance).
 */

let running = false;
let loopPromise = null;

async function runOnce() {
  const job = await claimNextJob();
  if (!job) return false;

  const handler = getHandler(job.type);
  const started = Date.now();
  try {
    if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
    await handler(job.payload ?? {}, job);
    await completeJob(job.id);
    console.log(`[job] ✓ ${job.type} ${job.id} ${Date.now() - started}ms`);
  } catch (err) {
    const terminal = await failJob(job, err).catch(() => true);
    console.error(`[job] ✗ ${job.type} ${job.id}: ${err?.message}${terminal ? ' (failed permanently)' : ''}`);
  }
  return true;
}

/** Drain up to `limit` runnable jobs. Returns how many were processed. */
export async function drainBatch(limit = config.jobs.batchSize) {
  let processed = 0;
  while (processed < limit) {
    let did;
    try {
      did = await runOnce();
    } catch (err) {
      console.error('[worker] claim failed:', err?.message);
      await sleep(config.jobs.pollMs);
      return processed;
    }
    if (!did) break;
    processed += 1;
  }
  return processed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loop() {
  try {
    const stale = await requeueStaleJobs();
    if (stale) console.log(`[worker] re-queued ${stale} abandoned job(s)`);
  } catch (err) {
    console.error('[worker] requeue failed:', err?.message);
  }

  while (running) {
    try {
      const processed = await drainBatch();
      if (!processed) await sleep(config.jobs.pollMs);
    } catch (err) {
      console.error('[worker] loop error:', err?.message);
      await sleep(config.jobs.pollMs);
    }
  }
}

export function startWorkerRuntime({ withScheduler = true } = {}) {
  if (running) return;
  running = true;
  console.log(`[worker] started (id=${process.pid}) — handlers: ${jobTypes().join(', ') || 'none'}`);
  if (withScheduler) startScheduler();
  loopPromise = loop();
}

export async function stopWorkerRuntime() {
  running = false;
  stopScheduler();
  if (loopPromise) {
    try {
      await Promise.race([loopPromise, sleep(3000)]);
    } catch {
      /* ignore */
    }
    loopPromise = null;
  }
}
