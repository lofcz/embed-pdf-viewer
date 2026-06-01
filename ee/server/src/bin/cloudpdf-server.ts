#!/usr/bin/env node
/* eslint-disable no-console */
import { buildApp } from '../app/buildApp';
import { createSqliteDb, type CreateSqliteDbOptions } from '../db/drivers/sqlite';
import { createPostgresDb, type CreatePostgresDbOptions } from '../db/drivers/postgres';
import { migrate, status, validate, type MigrationSource } from '../db/migrator/runner';
import { sqliteMigrations } from '../db/migrations/sqlite/index';
import { postgresMigrations } from '../db/migrations/postgres/index';
import type { Database as Schema } from '../db/schema';
import { EventLogService } from '../services/EventLogService';
import type { ObjectStore } from '../storage/ObjectStore';
import { createObjectStore } from '../storage/createObjectStore';
import { loadObjectStoreConfigFromEnv } from '../storage/config/loadObjectStoreConfigFromEnv';
import type { Kysely } from 'kysely';

/**
 * Multi-command CLI:
 *
 *   cloudpdf-server                          → serve (default)
 *   cloudpdf-server serve
 *   cloudpdf-server migrate status
 *   cloudpdf-server migrate up [--dry-run]
 *   cloudpdf-server migrate validate [--strict]
 *   cloudpdf-server db doctor
 *   cloudpdf-server audit export --day yesterday
 *   cloudpdf-server --help
 *
 * Config is read from env (12-factor friendly):
 *   EMBEDPDF_DB_DRIVER     sqlite|postgres   (default: sqlite)
 *   EMBEDPDF_DB_SQLITE_PATH                  (default: ./data/embedpdf.db)
 *   EMBEDPDF_DB_URL         postgres://...
 *   EMBEDPDF_JWT_SECRET    (default: dev secret; warn at startup)
 *   EMBEDPDF_STORAGE_KIND  fs|s3            (default: fs for audit export)
 *   EMBEDPDF_STORAGE_FS_ROOT                (default: ./data/objects)
 *   EMBEDPDF_STORAGE_S3_BUCKET
 *   EMBEDPDF_STORAGE_S3_REGION
 *   EMBEDPDF_STORAGE_S3_ENDPOINT            (optional)
 *   PORT                   (default: 3000)
 *   HOST                   (default: 0.0.0.0)
 *   POOL_SIZE              (default: auto)
 *   EMBEDPDF_FAIL_ON_PENDING=1   refuse to start with pending migrations
 *
 * Exit codes:
 *   0  success
 *   1  user error / drift / failed command
 *   2  missing required config
 */

type Dialect = 'sqlite' | 'postgres';

interface DbContext {
  dialect: Dialect;
  db: Kysely<Schema>;
  migrations: ReadonlyArray<MigrationSource>;
  describe: string;
}

function readDbConfig(): {
  dialect: Dialect;
  sqliteOpts?: CreateSqliteDbOptions;
  pgOpts?: CreatePostgresDbOptions;
  describe: string;
} {
  const driver = (process.env['EMBEDPDF_DB_DRIVER'] ?? 'sqlite').toLowerCase() as Dialect;
  if (driver === 'postgres') {
    const url = process.env['EMBEDPDF_DB_URL'];
    if (!url) {
      fail(2, 'EMBEDPDF_DB_DRIVER=postgres requires EMBEDPDF_DB_URL=postgres://...');
    }
    return {
      dialect: 'postgres',
      pgOpts: { connectionString: url! },
      describe: `postgres ${redact(url!)}`,
    };
  }
  if (driver !== 'sqlite') {
    fail(2, `EMBEDPDF_DB_DRIVER must be 'sqlite' or 'postgres' (got ${driver!})`);
  }
  const path = process.env['EMBEDPDF_DB_SQLITE_PATH'] ?? './data/embedpdf.db';
  return { dialect: 'sqlite', sqliteOpts: { path }, describe: `sqlite ${path}` };
}

function openDb(): DbContext {
  const cfg = readDbConfig();
  if (cfg.dialect === 'postgres') {
    return {
      dialect: 'postgres',
      db: createPostgresDb(cfg.pgOpts!),
      migrations: postgresMigrations,
      describe: cfg.describe,
    };
  }
  return {
    dialect: 'sqlite',
    db: createSqliteDb(cfg.sqliteOpts!),
    migrations: sqliteMigrations,
    describe: cfg.describe,
  };
}

async function openObjectStore(): Promise<ObjectStore> {
  try {
    return await createObjectStore(loadObjectStoreConfigFromEnv(process.env));
  } catch (err) {
    fail(2, err instanceof Error ? err.message : String(err));
  }
}

function redact(url: string): string {
  return url.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
}

function fail(code: number, msg: string): never {
  console.error(`cloudpdf-server: ${msg}`);
  process.exit(code);
}

function printHelp(): void {
  console.log(
    [
      'cloudpdf-server [command] [args]',
      '',
      'Commands:',
      '  serve                  (default) Start the HTTP server',
      '  migrate status         Show applied / pending / drift state',
      '  migrate up             Apply pending migrations',
      '  migrate up --dry-run   List what would be applied without changing the DB',
      '  migrate validate       Refuse to exit 0 if drift is detected',
      '  migrate validate --strict  Treat pending migrations as drift too',
      '  db doctor              Connect, run validate, print version info',
      '  audit export --day yesterday',
      '                          Export closed-day audit_log rows to JSONL storage',
      '',
      'Environment:',
      '  EMBEDPDF_DB_DRIVER     sqlite|postgres   (default: sqlite)',
      '  EMBEDPDF_DB_SQLITE_PATH                  (default: ./data/embedpdf.db)',
      '  EMBEDPDF_DB_URL        postgres://...',
      '  EMBEDPDF_STORAGE_KIND  fs|s3            (default: fs)',
      '  EMBEDPDF_STORAGE_FS_ROOT                (default: ./data/objects)',
      '  EMBEDPDF_STORAGE_S3_BUCKET, EMBEDPDF_STORAGE_S3_REGION',
      '  EMBEDPDF_JWT_SECRET    (required in production)',
      '  PORT, HOST, POOL_SIZE',
      '  EMBEDPDF_FAIL_ON_PENDING=1  refuse to serve with pending migrations',
    ].join('\n'),
  );
}

// ------- commands -------

async function cmdMigrateStatus(): Promise<void> {
  const ctx = openDb();
  try {
    const rows = await status(ctx.db, ctx.migrations);
    console.log(`db: ${ctx.describe}`);
    if (rows.length === 0) {
      console.log('(no migrations registered)');
      return;
    }
    for (const r of rows) {
      const when = r.appliedAt ? new Date(r.appliedAt).toISOString() : '-';
      console.log(`  ${r.version}  ${pad(r.state, 8)}  ${pad(r.name, 32)}  ${when}`);
      if (r.drift) {
        console.log(
          `      drift db=${r.drift.dbChecksum.slice(0, 12)}.. code=${r.drift.codeChecksum.slice(0, 12)}..`,
        );
      }
    }
    const hasDrift = rows.some((r) => r.state === 'drift' || r.state === 'orphan');
    process.exit(hasDrift ? 1 : 0);
  } finally {
    await ctx.db.destroy();
  }
}

async function cmdMigrateUp(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const ctx = openDb();
  try {
    if (dryRun) {
      const rows = await status(ctx.db, ctx.migrations);
      const pending = rows.filter((r) => r.state === 'pending');
      console.log(`db: ${ctx.describe}`);
      if (pending.length === 0) {
        console.log('no pending migrations');
        return;
      }
      console.log(`${pending.length} pending migration(s):`);
      for (const p of pending) {
        console.log(`  ${p.version}  ${p.name}`);
      }
      console.log('(dry-run: nothing applied)');
      return;
    }
    const applied = await migrate(ctx.db, {
      source: { kind: 'inline', migrations: ctx.migrations },
      onApply: (m) => console.log(`applying ${m.version} ${m.name}`),
    });
    if (applied.length === 0) {
      console.log('nothing to apply (db up to date)');
    } else {
      console.log(`applied ${applied.length} migration(s)`);
    }
  } finally {
    await ctx.db.destroy();
  }
}

async function cmdMigrateValidate(args: string[]): Promise<void> {
  const strict = args.includes('--strict');
  const ctx = openDb();
  try {
    const issues = await validate(ctx.db, ctx.migrations, { treatPendingAsDrift: strict });
    console.log(`db: ${ctx.describe}`);
    if (issues.length === 0) {
      console.log('ok (no drift)');
      return;
    }
    console.error(`drift detected (${issues.length} issue(s)):`);
    for (const i of issues) {
      console.error(`  - [${i.kind}] ${i.message}`);
    }
    process.exit(1);
  } finally {
    await ctx.db.destroy();
  }
}

async function cmdDbDoctor(): Promise<void> {
  const ctx = openDb();
  console.log(`db: ${ctx.describe}`);
  try {
    // 1. Connection check.
    await ctx.db.selectFrom('schema_migrations').select('version').limit(1).execute();
    console.log('  connection: ok');
  } catch (err) {
    console.error(`  connection: FAIL (${(err as Error).message})`);
    process.exit(1);
  }
  try {
    const issues = await validate(ctx.db, ctx.migrations);
    if (issues.length === 0) {
      console.log('  drift: none');
    } else {
      console.error(`  drift: ${issues.length} issue(s)`);
      for (const i of issues) console.error(`    - [${i.kind}] ${i.message}`);
      process.exit(1);
    }
    const rows = await status(ctx.db, ctx.migrations);
    const applied = rows.filter((r) => r.state === 'applied').length;
    const pending = rows.filter((r) => r.state === 'pending').length;
    console.log(`  migrations: ${applied} applied, ${pending} pending`);
  } finally {
    await ctx.db.destroy();
  }
}

async function cmdAuditExport(args: string[]): Promise<void> {
  const dayRaw = readFlagValue(args, '--day') ?? 'yesterday';
  const day = resolveAuditDay(dayRaw);
  const tenantId = readFlagValue(args, '--tenant');
  const docId = readFlagValue(args, '--doc');
  if ((tenantId && !docId) || (!tenantId && docId)) {
    fail(2, 'audit export requires --tenant and --doc together, or neither');
  }
  const force = args.includes('--force');
  const allowOpenDay = args.includes('--allow-open-day');
  const lagMinutes = readOptionalNumberFlag(args, '--lag-minutes') ?? 30;

  const dbCtx = openDb();
  const storage = await openObjectStore();
  const service = new EventLogService({ storage });
  try {
    console.log(`db: ${dbCtx.describe}`);
    console.log(`storage: ${storage.info.kind} ${storage.info.location}`);
    if (tenantId && docId) {
      const result = await service.exportDocDayJsonl(dbCtx.db, {
        tenantId,
        docId,
        day,
        force,
        allowOpenDay,
        closedDayLagMs: lagMinutes * 60 * 1000,
      });
      console.log(
        `audit export ${result.status}: day=${day} tenant=${tenantId} doc=${docId} ` +
          `events=${result.count} key=${result.key}`,
      );
      return;
    }
    const result = await service.exportDayJsonl(dbCtx.db, {
      day,
      force,
      allowOpenDay,
      closedDayLagMs: lagMinutes * 60 * 1000,
    });
    console.log(
      `audit export day=${day}: targets=${result.targets} exported=${result.exported} ` +
        `skipped=${result.skipped} alreadyRunning=${result.alreadyRunning} empty=${result.empty}`,
    );
  } finally {
    await dbCtx.db.destroy();
  }
}

async function cmdServe(): Promise<void> {
  const PORT = Number(process.env['PORT'] ?? 3000);
  const HOST = process.env['HOST'] ?? '0.0.0.0';
  const JWT_SECRET = process.env['EMBEDPDF_JWT_SECRET'] ?? 'embedpdf-dev-secret-change-me';
  if (JWT_SECRET === 'embedpdf-dev-secret-change-me') {
    console.warn(
      '[cloudpdf-server] WARNING: EMBEDPDF_JWT_SECRET not set, using insecure dev secret',
    );
  }
  const POOL_SIZE = process.env['POOL_SIZE'] ? Number(process.env['POOL_SIZE']) : undefined;
  const FAIL_ON_PENDING = process.env['EMBEDPDF_FAIL_ON_PENDING'] === '1';

  const WORKER_ENTRY_URL = new URL('../runtime/worker-entry.js', import.meta.url);

  // Open DB (if EMBEDPDF_DB_* env is set; otherwise serve admin-less).
  const driverEnv = process.env['EMBEDPDF_DB_DRIVER'];
  let dbCtx: DbContext | null = null;
  if (driverEnv) {
    dbCtx = openDb();
  }

  const bundle = await buildApp({
    verifier: { mode: 'hs256', secret: JWT_SECRET },
    poolSize: POOL_SIZE,
    workerEntry: WORKER_ENTRY_URL,
    db: dbCtx?.db,
    expectedMigrations: dbCtx?.migrations,
    failOnPending: FAIL_ON_PENDING,
  });

  const onSignal = async (sig: string) => {
    bundle.app.log.info({ sig }, 'received signal, shutting down');
    try {
      await bundle.shutdown();
      if (dbCtx) await dbCtx.db.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void onSignal('SIGINT'));
  process.on('SIGTERM', () => void onSignal('SIGTERM'));

  await bundle.app.listen({ port: PORT, host: HOST });
  bundle.app.log.info(
    { port: PORT, host: HOST, db: dbCtx?.describe ?? 'none' },
    'cloudpdf-server listening',
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// ------- entrypoint -------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    printHelp();
    return;
  }
  if (args.length === 0 || args[0] === 'serve') {
    await cmdServe();
    return;
  }
  if (args[0] === 'migrate') {
    const sub = args[1];
    const rest = args.slice(2);
    if (sub === 'status') return cmdMigrateStatus();
    if (sub === 'up') return cmdMigrateUp(rest);
    if (sub === 'validate') return cmdMigrateValidate(rest);
    fail(2, `unknown subcommand: migrate ${sub ?? '(missing)'}\nrun: cloudpdf-server --help`);
  }
  if (args[0] === 'db') {
    const sub = args[1];
    if (sub === 'doctor') return cmdDbDoctor();
    fail(2, `unknown subcommand: db ${sub ?? '(missing)'}\nrun: cloudpdf-server --help`);
  }
  if (args[0] === 'audit') {
    const sub = args[1];
    const rest = args.slice(2);
    if (sub === 'export') return cmdAuditExport(rest);
    fail(2, `unknown subcommand: audit ${sub ?? '(missing)'}\nrun: cloudpdf-server --help`);
  }
  fail(2, `unknown command: ${args[0]!}\nrun: cloudpdf-server --help`);
}

function readFlagValue(args: string[], name: string): string | undefined {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    fail(2, `${name} requires a value`);
  }
  return value;
}

function readOptionalNumberFlag(args: string[], name: string): number | undefined {
  const raw = readFlagValue(args, name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    fail(2, `${name} must be a non-negative number`);
  }
  return value;
}

function resolveAuditDay(value: string): string {
  if (value === 'yesterday') {
    return dayFromOffsetUtc(-1);
  }
  if (value === 'today') {
    return dayFromOffsetUtc(0);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(2, `--day must be YYYY-MM-DD, yesterday, or today (got ${value})`);
  }
  return value;
}

function dayFromOffsetUtc(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error('cloudpdf-server: failed:', err);
  process.exit(1);
});
