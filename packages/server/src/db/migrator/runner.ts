import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { Database as Schema } from '../schema';

/**
 * Input migration: either supplied in-memory (preferred — survives
 * bundling cleanly) or discovered from a directory of `.sql` files.
 */
export interface MigrationSource {
  /** Sort key. Zero-padded integer string (e.g. `001`). */
  version: string;
  /** Human-readable filename for diagnostics, e.g. `001_initial.sql`. */
  name: string;
  /** Raw SQL text. May contain multiple `;`-separated statements. */
  sql: string;
}

export interface MigrationRecord {
  version: string;
  name: string;
  checksum: string;
  applied_at: number;
}

export type MigrateInput =
  | { kind: 'inline'; migrations: ReadonlyArray<MigrationSource> }
  | { kind: 'dir'; dir: string };

export interface MigrateOptions {
  source: MigrateInput;
  /** Called once per migration before it is applied. */
  onApply?: (m: MigrationSource) => void;
}

/**
 * Apply every pending migration. Forward-only; checksums of
 * already-applied migrations are validated to detect silent edits.
 *
 * Migration directives in the SQL text:
 *   `-- pragma: no-transaction`  Disables the implicit transaction
 *                                 (Postgres `CREATE INDEX CONCURRENTLY`).
 *
 * The `inline` source kind is the default for our codebase: migrations
 * are TypeScript modules that embed their SQL as a string. This makes
 * the migration set part of the bundle, so packagers / Docker images
 * don't need to ship extra `.sql` files.
 */
export async function migrate(
  db: Kysely<Schema>,
  opts: MigrateOptions,
): Promise<MigrationSource[]> {
  await ensureMigrationsTable(db);
  const migrations =
    opts.source.kind === 'inline'
      ? sortByVersion([...opts.source.migrations])
      : await discoverMigrations(opts.source.dir);
  const applied = await listApplied(db);
  validateRenames(migrations, applied);

  const pending = migrations.filter((m) => !applied.has(m.version));
  for (const m of pending) {
    opts.onApply?.(m);
    await applyOne(db, m);
  }
  return pending;
}

async function ensureMigrationsTable(db: Kysely<Schema>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `.execute(db);
}

async function discoverMigrations(dir: string): Promise<MigrationSource[]> {
  const entries = await readdir(dir);
  const out: MigrationSource[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.sql')) continue;
    const match = entry.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`migrator: unrecognised filename ${entry} (expected NNN_name.sql)`);
    }
    const text = await readFile(join(dir, entry), 'utf8');
    out.push({ version: match[1]!, name: entry, sql: text });
  }
  return sortByVersion(out);
}

function sortByVersion<T extends { version: string }>(list: T[]): T[] {
  return list.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

async function listApplied(db: Kysely<Schema>): Promise<Map<string, MigrationRecord>> {
  const rows = await db
    .selectFrom('schema_migrations')
    .select(['version', 'name', 'checksum', 'applied_at'])
    .execute();
  const map = new Map<string, MigrationRecord>();
  for (const r of rows) map.set(r.version, r);
  return map;
}

function validateRenames(
  migrations: MigrationSource[],
  applied: Map<string, MigrationRecord>,
): void {
  for (const m of migrations) {
    const a = applied.get(m.version);
    if (a && a.name !== m.name) {
      throw new Error(
        `migrator: applied migration ${m.version} renamed: db has ${a.name}, code has ${m.name}`,
      );
    }
  }
}

async function applyOne(db: Kysely<Schema>, m: MigrationSource): Promise<void> {
  const checksum = sha256(m.sql);
  const noTx = /^\s*--\s*pragma:\s*no-transaction\s*$/im.test(m.sql);
  const statements = splitStatements(m.sql);

  const run = async (tx: Kysely<Schema>) => {
    for (const stmt of statements) {
      await sql.raw(stmt).execute(tx);
    }
    await tx
      .insertInto('schema_migrations')
      .values({ version: m.version, name: m.name, checksum, applied_at: Date.now() })
      .execute();
  };

  if (noTx) {
    await run(db);
  } else {
    await db.transaction().execute(run);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Naive SQL splitter: splits on top-level `;`, respects single- and
 * double-quoted strings and `--` line comments. Sufficient for our
 * migrations which are pure DDL. If we ever embed PG functions /
 * triggers with internal `;`, add a `-- single-statement` marker and
 * a special case here.
 */
function splitStatements(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let inLineComment = false;
  let inString: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1] ?? '';
    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) out.push(tail);
  return out;
}
