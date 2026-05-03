#!/usr/bin/env node
import { buildApp } from '../app/buildApp';

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const JWT_SECRET = process.env['EMBEDPDF_JWT_SECRET'] ?? 'embedpdf-dev-secret-change-me';
const POOL_SIZE = process.env['POOL_SIZE'] ? Number(process.env['POOL_SIZE']) : undefined;

// The bin always lives next to the built dist root in production, so
// the worker entry resolves cleanly relative to this file's URL.
const WORKER_ENTRY_URL = new URL('../runtime/worker-entry.js', import.meta.url);

async function main() {
  const bundle = await buildApp({
    jwtSecret: JWT_SECRET,
    poolSize: POOL_SIZE,
    workerEntry: WORKER_ENTRY_URL,
  });

  const onSignal = async (sig: string) => {
    bundle.app.log.info({ sig }, 'received signal, shutting down');
    try {
      await bundle.shutdown();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void onSignal('SIGINT'));
  process.on('SIGTERM', () => void onSignal('SIGTERM'));

  await bundle.app.listen({ port: PORT, host: HOST });
  bundle.app.log.info({ port: PORT, host: HOST }, 'embedpdf-server listening');
}

main().catch((err) => {
  console.error('failed to start server:', err);
  process.exit(1);
});
