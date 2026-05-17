/**
 * Logical database schema for @embedpdf/server.
 *
 * Source of truth for both SQLite (Phase 1) and Postgres (Phase 2). The
 * column shapes here are the dialect-agnostic view; per-dialect migration
 * files under `db/migrations/{sqlite,postgres}/` adapt them to actual
 * column types (TEXT/INTEGER for SQLite, equivalents for PG).
 *
 * Phase 1 ships only `tenants`, `documents`, and `schema_migrations`.
 * Later phases add `document_pages`, `layers`, `layer_pages`,
 * `revoked_jtis`, `jwks_cache`, `audit_log`, and weak annotation sessions.
 */

import type { Generated } from 'kysely';

/**
 * Lifecycle state of a `documents` row.
 *
 * - `pending`  - row reserved; bytes not yet committed (init call returned
 *                a presigned PUT or upload-direct URL).
 * - `ready`    - bytes verified (sha matches) and visible to the engine.
 * - `failed`   - terminal failure (sha mismatch, timeout, explicit abort).
 * - `deleting` - cascade-delete in progress; storage prefix being torn down.
 */
export type DocumentState = 'pending' | 'ready' | 'failed' | 'deleting';

export interface TenantsTable {
  id: string;
  name: string;
  config_json: string | null;
  created_at: number;
}

export interface DocumentsTable {
  id: string;
  tenant_id: string;
  state: DocumentState;
  base_sha: string | null;
  storage_size_bytes: number | null;
  page_count: number | null;
  doc_version: Generated<number>;
  metadata_json: string | null;
  /** Customer-supplied retry key; unique per `(tenant_id, idempotency_key)`. */
  idempotency_key: string | null;
  /**
   * If `state = 'failed'`, a short machine-readable reason
   * (`sha_mismatch`, `upload_timeout`, `aborted`).
   */
  failure_reason: string | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
}

export interface DocumentPagesTable {
  doc_id: string;
  page_object_number: number;
  page_index: number;
  content_version: number;
  annotation_version: number;
  annotation_generation: number;
  has_weak_annotations: boolean | number;
  updated_at: number;
}

export interface LayersTable {
  id: string;
  doc_id: string;
  tenant_id: string;
  name: string;
  doc_version: number;
  current_version: number;
  current_artifact_key: string | null;
  current_artifact_sha: string | null;
  current_artifact_size: number | null;
  created_at: number;
  updated_at: number;
}

export interface LayerPagesTable {
  layer_id: string;
  page_object_number: number;
  page_index: number;
  content_version: number;
  annotation_version: number;
  annotation_generation: number;
  has_weak_annotations: boolean | number;
  updated_at: number;
}

export interface WeakAnnotationSessionsTable {
  id: string;
  tenant_id: string;
  doc_id: string;
  layer_name: string;
  sub: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface WeakAnnotationSessionPagesTable {
  session_id: string;
  page_object_number: number;
  updated_at: number;
  expires_at: number;
}

export interface SchemaMigrationsTable {
  /** Monotonically-increasing version (zero-padded for lexical sort). */
  version: string;
  /** Migration filename, for diagnostics. */
  name: string;
  /** SHA-256 of the migration file contents at apply time. */
  checksum: string;
  /** Unix epoch ms when the migration was applied. */
  applied_at: number;
}

/**
 * Phase 2 — per-token denylist consulted on every authenticated
 * request. Fronted by `RevokedJtisGuard`'s in-memory LRU so the DB
 * round-trip happens only on cache misses.
 */
export interface RevokedJtisTable {
  /** Opaque token id; PK. */
  jti: string;
  /** Tenant context for audit; nullable for system-issued tokens. */
  tenant_id: string | null;
  /** Short reason: `manual`, `password-rotation`, `compromise`, ... */
  reason: string | null;
  /** Unix epoch ms. */
  revoked_at: number;
  /** Unix epoch ms — same as the token's `exp`, used by GC sweeper. */
  expires_at: number;
}

/**
 * Phase 2 — persistent JWKS cache keyed by issuer. The actual
 * verifier uses `jose`'s in-memory cache; this table is the
 * cold-boot warm-up so we don't slam the customer's IdP on every
 * pod restart.
 */
export interface JwksCacheTable {
  issuer: string;
  jwks_json: string;
  fetched_at: number;
  expires_at: number;
}

/**
 * The Kysely `Database` interface that the rest of the server typechecks
 * against. Each table maps to a single TypeScript shape; Kysely handles
 * INSERT/SELECT differences via the `Generated<T>` brand.
 */
export interface Database {
  tenants: TenantsTable & { created_at: Generated<number> };
  documents: DocumentsTable & {
    created_at: Generated<number>;
    updated_at: Generated<number>;
  };
  document_pages: DocumentPagesTable;
  layers: LayersTable;
  layer_pages: LayerPagesTable;
  weak_annotation_sessions: WeakAnnotationSessionsTable;
  weak_annotation_session_pages: WeakAnnotationSessionPagesTable;
  schema_migrations: SchemaMigrationsTable;
  revoked_jtis: RevokedJtisTable;
  jwks_cache: JwksCacheTable;
}
