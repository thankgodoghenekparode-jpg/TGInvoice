import app from './app.js';
import config, { assertSecrets } from './config.js';
import { prisma } from './prisma.js';
import { startWorkerRuntime, stopWorkerRuntime } from './services/workerRuntime.js';

assertSecrets();

const server = app.listen(config.port, () => {
  console.log(`\n  TG Invoice API — tgeasy`);
  console.log(`  ${config.env} · http://localhost:${config.port}/api/health\n`);
});

// Dev / single-instance convenience: drain the job queue in this process.
// Production should run `npm run worker` as a separate service instead.
if (config.jobs.inline) startWorkerRuntime({ withScheduler: true });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Set PORT in .env to a free port.`);
  } else {
    console.error('Server failed to start:', err.message);
  }
  process.exit(1);
});

// Prisma keeps the process alive; exit cleanly on shutdown signals.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await stopWorkerRuntime().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    server.close(() => process.exit(0));
  });
}
