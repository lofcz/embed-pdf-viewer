/**
 * @embedpdf/server - self-hostable Engine v3 server.
 *
 * Programmatic API used by tests and integrators. The CLI entry point lives
 * at bin/embedpdf-server.ts.
 */
export { buildApp } from './app/buildApp';
export type { BuildAppOptions, AppBundle } from './app/buildApp';
export { JwtVerifier, signDevToken, hasAdminScope } from './auth/JwtVerifier';
export type {
  JwtClaims,
  JwtVerifierOptions,
  SignDevTokenInput,
  AdminScope,
} from './auth/JwtVerifier';
export { WorkerThreadPool } from './runtime/WorkerThreadPool';
export type { WorkerThreadPoolOptions } from './runtime/WorkerThreadPool';
export { InMemoryDocumentStore } from './storage/InMemoryDocumentStore';
export type { DocumentRecord } from './storage/InMemoryDocumentStore';

// Phase 1 cloud platform surfaces.
export { createSqliteDb } from './db/drivers/sqlite';
export type { CreateSqliteDbOptions } from './db/drivers/sqlite';
export { migrate } from './db/migrator/runner';
export type { MigrationSource, MigrateInput, MigrateOptions } from './db/migrator/runner';
export { sqliteMigrations } from './db/migrations/sqlite/index';
export type {
  Database as DbSchema,
  DocumentState,
  TenantsTable,
  DocumentsTable,
} from './db/schema';
export { DocumentsRepo } from './db/repos/documents.repo';
export type { DocumentRow, CreatePendingInput, CommitInput } from './db/repos/documents.repo';
export { TenantsRepo } from './db/repos/tenants.repo';
export type { TenantRow } from './db/repos/tenants.repo';
export { StorageKeys } from './storage/keys';
export { FsObjectStore } from './storage/adapters/FsObjectStore';
export type { FsObjectStoreOptions } from './storage/adapters/FsObjectStore';
export { S3ObjectStore } from './storage/adapters/S3ObjectStore';
export type { S3ObjectStoreOptions } from './storage/adapters/S3ObjectStore';
export type {
  ObjectStore,
  ObjectStoreWithInfo,
  ObjectStoreInfo,
  ObjectBody,
  ObjectStat,
  PresignedUpload,
  PresignedDownload,
  PresignUploadOpts,
} from './storage/ObjectStore';
export { DocumentLifecycleService } from './services/DocumentLifecycleService';
export type {
  DocumentLifecycleOptions,
  DedupMode,
  InitInput,
  InitResult,
  InitUpload,
  CommitResult,
  UploadDirectInput,
} from './services/DocumentLifecycleService';

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
