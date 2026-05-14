/**
 * Logical database schema for @embedpdf/server.
 *
 * Source of truth for both SQLite (Phase 1) and Postgres (Phase 2). The
 * column shapes here are the dialect-agnostic view; per-dialect migration
 * files under `db/migrations/{sqlite,postgres}/` adapt them to actual
 * column types (TEXT/INTEGER for SQLite, equivalents for PG).
 *
 * Phase 1 ships only `tenants`, `documents`, and `schema_migrations`.
 * Later phases add `layers`, `layer_pages`, `revoked_jtis`,
 * `jwks_cache`, `audit_log`, and `edit_leases`.
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
  schema_migrations: SchemaMigrationsTable;
}
