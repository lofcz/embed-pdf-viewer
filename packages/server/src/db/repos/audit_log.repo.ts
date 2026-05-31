import type { Kysely, Transaction } from 'kysely';
import type { Database as Schema } from '../schema';

export type AuditMutationKind =
  | 'annot.create'
  | 'annot.update'
  | 'annot.delete'
  | 'annot.move'
  | 'pages.move'
  | 'metadata.update';

export interface AppendAuditLogInput {
  tenantId: string;
  docId: string;
  layerId: string;
  layerName: string;
  ts: number;
  sub: string;
  kind: AuditMutationKind;
  pageObjectNumber: number | null;
  affectedPages: number[];
  artifactVersion: number;
  artifactKey: string;
  artifactSha: string;
  artifactSize: number;
  idempotencyKey?: string | null;
  payload: unknown;
}

export interface AuditLogRow extends AppendAuditLogInput {
  id: number;
}

export interface AuditDocKey {
  tenantId: string;
  docId: string;
}

type DbExecutor = Kysely<Schema> | Transaction<Schema>;

export class AuditLogRepo {
  constructor(private readonly db: DbExecutor) {}

  async append(input: AppendAuditLogInput): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        tenant_id: input.tenantId,
        doc_id: input.docId,
        layer_id: input.layerId,
        layer_name: input.layerName,
        ts: input.ts,
        sub: input.sub,
        kind: input.kind,
        page_object_number: input.pageObjectNumber,
        affected_pages_json: JSON.stringify(input.affectedPages),
        artifact_version: input.artifactVersion,
        artifact_key: input.artifactKey,
        artifact_sha: input.artifactSha,
        artifact_size: input.artifactSize,
        idempotency_key: input.idempotencyKey ?? null,
        payload_json: JSON.stringify(input.payload),
      })
      .execute();
  }

  async findForDocTimeRange(input: {
    tenantId: string;
    docId: string;
    startTs: number;
    endTs: number;
  }): Promise<AuditLogRow[]> {
    const rows = await this.db
      .selectFrom('audit_log')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('doc_id', '=', input.docId)
      .where('ts', '>=', input.startTs)
      .where('ts', '<', input.endTs)
      .orderBy('ts', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map((row) => ({
      id: Number(row.id),
      tenantId: row.tenant_id,
      docId: row.doc_id,
      layerId: row.layer_id,
      layerName: row.layer_name,
      ts: Number(row.ts),
      sub: row.sub,
      kind: row.kind as AuditMutationKind,
      pageObjectNumber: row.page_object_number === null ? null : Number(row.page_object_number),
      affectedPages: parseNumberArray(row.affected_pages_json),
      artifactVersion: Number(row.artifact_version),
      artifactKey: row.artifact_key,
      artifactSha: row.artifact_sha,
      artifactSize: Number(row.artifact_size),
      idempotencyKey: row.idempotency_key,
      payload: JSON.parse(row.payload_json) as unknown,
    }));
  }

  async findDocKeysForTimeRange(input: { startTs: number; endTs: number }): Promise<AuditDocKey[]> {
    const rows = await this.db
      .selectFrom('audit_log')
      .select(['tenant_id', 'doc_id'])
      .where('ts', '>=', input.startTs)
      .where('ts', '<', input.endTs)
      .groupBy(['tenant_id', 'doc_id'])
      .orderBy('tenant_id', 'asc')
      .orderBy('doc_id', 'asc')
      .execute();
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      docId: row.doc_id,
    }));
  }
}

function parseNumberArray(json: string): number[] {
  const value = JSON.parse(json) as unknown;
  return Array.isArray(value) ? value.map((item) => Number(item)) : [];
}
