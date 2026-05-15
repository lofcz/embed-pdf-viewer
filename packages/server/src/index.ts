/**
 * @embedpdf/server - self-hostable Engine v3 server.
 *
 * Programmatic API used by tests and integrators. The CLI entry point lives
 * at bin/embedpdf-server.ts.
 */
export { buildApp } from './app/buildApp';
export type { BuildAppOptions, AppBundle } from './app/buildApp';
export {
  createJwtVerifier,
  Hs256Verifier,
  AsymmetricVerifier,
  JwksVerifier,
  signDevToken,
  hasTenantScope,
  hasDocScope,
  isTenantClaims,
  isDocUserClaims,
} from './auth/JwtVerifier';
export type {
  BaseClaims,
  DocUserClaims,
  TenantClaims,
  JwtClaims,
  JwtVerifier,
  JwtVerifierConfig,
  JwtAudienceProfile,
  JwksCacheStore,
  RevocationCheck,
  SignDevTokenInput,
  TenantScope,
  DocScope,
} from './auth/JwtVerifier';
export { requireTenant, requireScope, requireDocAccess } from './app/jwt-plugin';
export type { DocAccessMode } from './app/jwt-plugin';
export { RevokedJtisGuard } from './auth/RevokedJtisGuard';
export type { RevokedJtisGuardOptions } from './auth/RevokedJtisGuard';
export { DbJwksCacheStore } from './auth/JwksCacheStore';
export { WorkerThreadPool } from './runtime/WorkerThreadPool';
export type { WorkerThreadPoolOptions } from './runtime/WorkerThreadPool';
export { InMemoryDocumentStore } from './storage/InMemoryDocumentStore';
export type { DocumentRecord } from './storage/InMemoryDocumentStore';

// Phase 1 cloud platform surfaces.
export { createSqliteDb } from './db/drivers/sqlite';
export type { CreateSqliteDbOptions } from './db/drivers/sqlite';
export { createPostgresDb } from './db/drivers/postgres';
export type { CreatePostgresDbOptions } from './db/drivers/postgres';
export { migrate, status, validate, validateOrThrow } from './db/migrator/runner';
export type {
  MigrationSource,
  MigrateInput,
  MigrateOptions,
  MigrationStatusEntry,
  DriftIssue,
  DriftKind,
} from './db/migrator/runner';
export { sqliteMigrations } from './db/migrations/sqlite/index';
export { postgresMigrations } from './db/migrations/postgres/index';
export type {
  Database as DbSchema,
  DocumentState,
  TenantsTable,
  DocumentsTable,
  DocumentPagesTable,
  LayersTable,
  LayerPagesTable,
} from './db/schema';
export { DocumentsRepo } from './db/repos/documents.repo';
export type { DocumentRow, CreatePendingInput, CommitInput } from './db/repos/documents.repo';
export { TenantsRepo } from './db/repos/tenants.repo';
export type { TenantRow } from './db/repos/tenants.repo';
export { DocumentPagesRepo, LayersRepo, LayerPagesRepo } from './db/repos/page_state.repo';
export type {
  DurablePageRow,
  UpsertDurablePageInput,
  LayerRow,
  CreateLayerInput,
} from './db/repos/page_state.repo';
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

// Phase 3 — document open + worker integration.
export { BaseFileCache, fileSha256 } from './storage/BaseFileCache';
export type {
  BaseFileCacheOptions,
  BaseFileCacheEvent,
  LocalFileHandle,
} from './storage/BaseFileCache';
export type { MaterializeOpts, MaterializeResult } from './storage/ObjectStore';
export { DocumentService } from './services/DocumentService';
export type {
  DocumentServiceOptions,
  DocumentHead,
  DocumentManifest,
  OpenContext,
} from './services/DocumentService';
export { LayerStateService } from './services/LayerStateService';
export type { LayerStateServiceOptions, MutationImpactKind } from './services/LayerStateService';

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
