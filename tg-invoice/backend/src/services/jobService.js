import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';
import config from '../config.js';

/**
 * Durable background job queue backed by Postgres — no Redis/cron required.
 *
 * `enqueue()` writes a row; `claimNextJob()` atomically leases one job with
 * `FOR UPDATE SKIP LOCKED`, so any number of worker processes can drain the
 * queue concurrently without double-processing. The runtime (`workerRuntime`)
 * drives claim → handler → complete/fail; failures retry with exponential
 * backoff up to `maxAttempts`, then park as FAILED with `lastError` for triage.
 */

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export const JOB_STATUS = { PENDING: 'PENDING', RUNNING: 'RUNNING', DONE: 'DONE', FAILED: 'FAILED' };

/**
 * @param {string} type  registered handler type, e.g. 'recurring.scan'
 * @param {object} payload
 * @param {{ runAt?: Date, priority?: number, maxAttempts?: number, dedupeKey?: string }} [opts]
 *        `dedupeKey` makes the enqueue idempotent — a second insert of a live
 *        duplicate returns null instead of creating a second job.
 */
export async function enqueue(type, payload = {}, opts = {}) {
  try {
    return await prisma.job.create({
      data: {
        type,
        payload: payload ?? {},
        runAt: opts.runAt ?? new Date(),
        priority: opts.priority ?? 0,
        maxAttempts: opts.maxAttempts ?? config.jobs.maxAttempts,
        dedupeKey: opts.dedupeKey ?? null,
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') return null; // dedupeKey already taken → already scheduled
    console.error('[job-enqueue]', err?.message);
    throw err;
  }
}

/** Lease the next runnable job, or null when the queue is empty. */
export async function claimNextJob() {
  const rows = await prisma.$queryRaw`
    UPDATE "Job"
    SET status = 'RUNNING',
        "lockedAt" = now(),
        "lockedBy" = ${WORKER_ID},
        attempts = attempts + 1,
        "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'PENDING' AND "runAt" <= now()
      ORDER BY priority DESC, "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts, "maxAttempts"`;
  return rows?.[0] ?? null;
}

export async function completeJob(id) {
  await prisma.job.update({
    where: { id },
    data: { status: JOB_STATUS.DONE, finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
  });
}

export async function failJob(job, err) {
  const attempts = job.attempts ?? 1;
  const terminal = attempts >= (job.maxAttempts ?? config.jobs.maxAttempts);
  const backoffMs = Math.min(15 * 60 * 1000, 2 ** attempts * 1000); // 2s, 4s, … capped at 15m
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: terminal ? JOB_STATUS.FAILED : JOB_STATUS.PENDING,
      lastError: String(err?.message || err || 'unknown error').slice(0, 500),
      lockedAt: null,
      lockedBy: null,
      runAt: terminal ? undefined : new Date(Date.now() + backoffMs),
      finishedAt: terminal ? new Date() : null,
    },
  });
  return terminal;
}

/** Return jobs abandoned by a crashed worker to the queue. */
export async function requeueStaleJobs() {
  const cutoff = new Date(Date.now() - config.jobs.staleMs);
  const { count } = await prisma.job.updateMany({
    where: { status: JOB_STATUS.RUNNING, lockedAt: { lt: cutoff } },
    data: { status: JOB_STATUS.PENDING, lockedAt: null, lockedBy: null },
  });
  return count;
}

/** Keep the queue table small — finished jobs are only kept for triage. */
export async function purgeFinishedJobs(olderThanDays = 7) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.job.deleteMany({
    where: { status: { in: [JOB_STATUS.DONE, JOB_STATUS.FAILED] }, finishedAt: { lt: cutoff } },
  });
  return count;
}

export async function jobStats() {
  const grouped = await prisma.job.groupBy({ by: ['status'], _count: { _all: true } });
  const out = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0 };
  for (const row of grouped) out[row.status] = row._count._all;
  return out;
}

export { WORKER_ID };
