import app from './app.js';
import config, { assertSecrets } from './config.js';

assertSecrets();

const server = app.listen(config.port, () => {
  console.log(`\n  TG Invoice API — tgeasy`);
  console.log(`  ${config.env} · http://localhost:${config.port}/api/health\n`);
});

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
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
