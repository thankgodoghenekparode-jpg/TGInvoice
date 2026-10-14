import config, { assertSecrets } from './config.js';
import { prisma } from './prisma.js';
import { startWorkerRuntime, stopWorkerRuntime } from './services/workerRuntime.js';

/**
 * Dedicated background worker:  npm run worker
 *
 * Deploy this as a second process/service (Render "Background Worker") so API
 * instances stay request-focused. Drains the Postgres job queue and runs the
 * in-process scheduler for recurring invoices / dunning reminders.
 */

assertSecrets();

console.log(`\n  TG Invoice worker — ${config.env}\n`);
startWorkerRuntime({ withScheduler: true });

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[worker] ${signal} — draining…`);
    await stopWorkerRuntime();
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
}
