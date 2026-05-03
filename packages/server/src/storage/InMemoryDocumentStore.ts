/**
 * Lightweight in-memory store of opened documents, keyed by docId.
 * Used by the alpha slice to track tenant ownership; persistence and
 * blob storage land in a future slice.
 */
export interface DocumentRecord {
  docId: string;
  tenantId: string;
  createdAt: number;
}

export class InMemoryDocumentStore {
  private readonly records = new Map<string, DocumentRecord>();

  put(record: DocumentRecord): void {
    this.records.set(record.docId, record);
  }

  get(docId: string): DocumentRecord | undefined {
    return this.records.get(docId);
  }

  remove(docId: string): boolean {
    return this.records.delete(docId);
  }

  has(docId: string): boolean {
    return this.records.has(docId);
  }

  /** Throws unless `docId` exists AND belongs to `tenantId`. */
  requireOwned(docId: string, tenantId: string): DocumentRecord {
    const r = this.records.get(docId);
    if (!r) {
      const err = new Error(`document not found: ${docId}`);
      (err as Error & { code: string }).code = 'NotFound';
      throw err;
    }
    if (r.tenantId !== tenantId) {
      const err = new Error(`document does not belong to tenant: ${docId}`);
      (err as Error & { code: string }).code = 'Forbidden';
      throw err;
    }
    return r;
  }
}
