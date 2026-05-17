import type { MigrationSource } from '../../migrator/runner';
import sql001 from './001_initial.sql';
import sql002 from './002_auth.sql';
import sql003 from './003_layer_state.sql';
import sql004 from './004_weak_annotation_sessions.sql';
import sql005 from './005_audit_log.sql';
import sql006 from './006_audit_exports.sql';

/**
 * Postgres migration set, dialect-parallel to `./sqlite`. The `.sql`
 * files in this directory are the canonical, syntax-highlighted source;
 * tsup's text loader inlines them at bundle time (see the SQLite
 * index for the same pattern + sql.d.ts shim).
 *
 * The repo conformance test (`test/_helpers/db-conformance.ts`)
 * asserts that both this set and the SQLite set produce repos that
 * pass the exact same behavioural suite — proving the abstraction is
 * real.
 */
export const postgresMigrations: ReadonlyArray<MigrationSource> = [
  { version: '001', name: '001_initial.sql', sql: sql001 },
  { version: '002', name: '002_auth.sql', sql: sql002 },
  { version: '003', name: '003_layer_state.sql', sql: sql003 },
  { version: '004', name: '004_weak_annotation_sessions.sql', sql: sql004 },
  { version: '005', name: '005_audit_log.sql', sql: sql005 },
  { version: '006', name: '006_audit_exports.sql', sql: sql006 },
];
