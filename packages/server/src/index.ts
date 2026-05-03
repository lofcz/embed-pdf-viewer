/**
 * @embedpdf/server - self-hostable Engine v3 server.
 *
 * Programmatic API used by tests and integrators. The CLI entry point lives
 * at bin/embedpdf-server.ts.
 */
export { buildApp } from './app/buildApp';
export type { BuildAppOptions, AppBundle } from './app/buildApp';
export { JwtVerifier, signDevToken } from './auth/JwtVerifier';
export type { JwtClaims, JwtVerifierOptions, SignDevTokenInput } from './auth/JwtVerifier';
export { WorkerThreadPool } from './runtime/WorkerThreadPool';
export type { WorkerThreadPoolOptions } from './runtime/WorkerThreadPool';
export { InMemoryDocumentStore } from './storage/InMemoryDocumentStore';
export type { DocumentRecord } from './storage/InMemoryDocumentStore';

/**
 * Stable URL of the bundled worker_thread entry. Resolves to:
 *   - `src/runtime/worker-entry.ts` during dev (tsx)
 *   - `dist/runtime/worker-entry.js` after the Vite build
 *
 * Anchored on `import.meta.url` of this file so it survives Vite's
 * library-mode chunk splitting (the entry of the package always lives at
 * the dist root, regardless of how shared code is factored out).
 */
export const defaultWorkerEntryUrl: URL = new URL('./runtime/worker-entry.js', import.meta.url);
