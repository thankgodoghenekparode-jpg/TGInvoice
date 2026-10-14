/**
 * Durable job queue (Postgres, FOR UPDATE SKIP LOCKED).
 *
 * This is the foundation for recurring invoices, dunning reminders and any
 * async delivery: work must survive a process restart, never double-run, and
 * retry with backoff before parking as FAILED for triage.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma.js';
import {
  enqueue,
  claimNextJob,
  completeJob,
  failJob,
  requeueStaleJobs,
  purgeFinishedJobs,
  jobStats,
} from '../src/services/jobService.js';
import { drainBatch } from '../src/services/workerRuntime.js';

const TYPE = 'test.queued';

before(async () => {
  // The queue is global infrastructure — clear leftovers from earlier runs so
  // claims below are deterministic.
  await prisma.job.deleteMany({});
});

after(async () => {
  await prisma.job.deleteMany({});
  await prisma.$disconnect();
});

test('enqueue then claim leases the job exactly once (status RUNNING, attempt counted)', async () => {
  const job = await enqueue(TYPE, { a: 1 });
  assert.ok(job, 'job should be created');
  assert.equal(job.status, 'PENDING');

  const claimed = await claimNextJob();
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.attempts, 1);
  assert.deepEqual(claimed.payload, { a: 1 });

  const rows = await prisma.job.findMany({ where: { id: job.id } });
  assert.equal(rows[0].status, 'RUNNING');
  assert.ok(rows[0].lockedBy, 'the lease records which worker owns the job');

  await completeJob(job.id);
  const done = await prisma.job.findUnique({ where: { id: job.id } });
  assert.equal(done.status, 'DONE');
  assert.ok(done.finishedAt);
});

test('a dedupeKey makes enqueue idempotent (only one live job per bucket)', async () => {
  const key = 'periodic:test.dedupe:1000';
  const first = await enqueue(TYPE, { n: 1 }, { dedupeKey: key });
  const second = await enqueue(TYPE, { n: 2 }, { dedupeKey: key });

  assert.ok(first, 'the first enqueue creates the job');
  assert.equal(second, null, 'the duplicate is swallowed, not raised as an error');

  const count = await prisma.job.count({ where: { dedupeKey: key } });
  assert.equal(count, 1);
  await prisma.job.deleteMany({ where: { dedupeKey: key } });
});

test('concurrent workers never lease the same job (SKIP LOCKED)', async () => {
  const created = [];
  for (let i = 0; i < 5; i += 1) created.push(await enqueue(TYPE, { i }));

  // Drain faster than the poll loop: five simultaneous claimants.
  const claimed = await Promise.all([claimNextJob(), claimNextJob(), claimNextJob(), claimNextJob(), claimNextJob()]);
  const ids = claimed.filter(Boolean).map((j) => j.id);

  assert.equal(new Set(ids).size, ids.length, 'no job may be leased twice');
  assert.ok(ids.length >= 1, 'jobs were available to lease');
  // Any left claimed at this instant is fine; the point is no double lease.
  for (const id of new Set(ids)) {
    const row = await prisma.job.findUnique({ where: { id } });
    assert.equal(row.status, 'RUNNING');
  }
  await prisma.job.deleteMany({ where: { type: TYPE } });
});

test('failures retry with backoff and only park as FAILED after maxAttempts', async () => {
  const job = await enqueue(TYPE, { i: 'retry' }, { maxAttempts: 2 });

  // Attempt 1 → fail → queued again for later.
  const first = await claimNextJob();
  assert.equal(first.id, job.id);
  const stillPending = await failJob(first, new Error('provider timed out'));
  assert.equal(stillPending, false, 'under maxAttempts the job must retry');
  let row = await prisma.job.findUnique({ where: { id: job.id } });
  assert.equal(row.status, 'PENDING');
  assert.match(row.lastError, /provider timed out/);
  assert.ok(row.runAt > new Date(), 'the retry is scheduled in the future (backoff)');

  // Make the backoff due immediately and fail attempt 2 → terminal.
  await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } });
  const second = await claimNextJob();
  assert.equal(second.id, job.id);
  const terminal = await failJob(second, new Error('still down'));
  assert.equal(terminal, true, 'attempt 2 of 2 must be terminal');
  row = await prisma.job.findUnique({ where: { id: job.id } });
  assert.equal(row.status, 'FAILED');
  assert.ok(row.finishedAt);

  await prisma.job.deleteMany({ where: { id: job.id } });
});

test('abandoned RUNNING jobs (crashed worker) are returned to the queue', async () => {
  const job = await enqueue(TYPE, { i: 'stale' });
  const claimed = await claimNextJob();
  assert.equal(claimed.id, job.id);
  // Simulate a crash: the lease is older than the stale threshold.
  await prisma.job.update({ where: { id: job.id }, data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) } });

  const requeued = await requeueStaleJobs();
  assert.ok(requeued >= 1, 'the abandoned job must be re-queued');
  const row = await prisma.job.findUnique({ where: { id: job.id } });
  assert.equal(row.status, 'PENDING');
  assert.equal(row.lockedBy, null);

  await prisma.job.deleteMany({ where: { id: job.id } });
});

test('finished jobs are purged only after their retention window', async () => {
  const old = await enqueue(TYPE, { i: 'old' });
  await prisma.job.update({
    where: { id: old.id },
    data: { status: 'DONE', finishedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  });
  const fresh = await enqueue(TYPE, { i: 'fresh' });
  await prisma.job.update({ where: { id: fresh.id }, data: { status: 'DONE', finishedAt: new Date() } });

  const removed = await purgeFinishedJobs(7);
  assert.ok(removed >= 1, 'expired finished jobs are removed');
  const stillThere = await prisma.job.findUnique({ where: { id: fresh.id } });
  assert.ok(stillThere, 'recent jobs stay around for triage');

  await prisma.job.deleteMany({});
  const stats = await jobStats();
  assert.equal(stats.DONE, 0);
});

test('the worker runtime leases, dispatches to the handler and marks the job DONE', async () => {
  await prisma.job.deleteMany({ where: { type: 'system.ping' } });
  const job = await enqueue('system.ping', { hello: 'world' });

  const processed = await drainBatch(50);
  assert.ok(processed >= 1, 'the runtime must pick the queued job up');

  const row = await prisma.job.findUnique({ where: { id: job.id } });
  assert.equal(row.status, 'DONE');
  assert.equal(row.lastError, null);
  assert.ok(row.finishedAt);
  await prisma.job.deleteMany({ where: { type: 'system.ping' } });
});

test('an unknown job type fails permanently instead of looping forever', async () => {
  await prisma.job.deleteMany({ where: { type: 'test.no-handler' } });
  const job = await enqueue('test.no-handler', {}, { maxAttempts: 1 });
  await drainBatch(5);
  const row = await prisma.job.findUnique({ where: { id: job.id } });
  assert.equal(row.status, 'FAILED');
  assert.match(row.lastError, /No handler registered/);
  await prisma.job.deleteMany({ where: { type: 'test.no-handler' } });
});
