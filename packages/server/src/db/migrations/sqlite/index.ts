import type { MigrationSource } from '../../migrator/runner';
import sql001 from './001_initial.sql';
import sql002 from './002_auth.sql';
import sql003 from './003_layer_state.sql';
import sql004 from './004_weak_annotation_sessions.sql';
import sql005 from './005_audit_log.sql';
import sql006 from './006_audit_exports.sql';

/**
 * SQLite migration set. The `.sql` files in this directory are the
 * canonical, syntax-highlighted source; they're inlined into the
 * build output at bundle time by tsup's text loader (and by the
 * matching Vite plugin in `vitest.config.ts`). See `src/types/sql.d.ts`
 * for the import shim.
 *
 * A parallel set under `db/migrations/postgres/` covers the PG
 * dialect, with a conformance test asserting both reach the same
 * logical schema.
 */
export const sqliteMigrations: ReadonlyArray<MigrationSource> = [
  { version: '001', name: '001_initial.sql', sql: sql001 },
  { version: '002', name: '002_auth.sql', sql: sql002 },
  { version: '003', name: '003_layer_state.sql', sql: sql003 },
  { version: '004', name: '004_weak_annotation_sessions.sql', sql: sql004 },
  { version: '005', name: '005_audit_log.sql', sql: sql005 },
  { version: '006', name: '006_audit_exports.sql', sql: sql006 },
];
