import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentPagesService,
  type PageListSnapshot,
  type PageMoveResult,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import { PageMoveResultSchema, wirePaths } from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';
import type { ManifestAccessor } from './CloudDocumentHandle';

/**
 * Cloud-side document pages service. Mirrors `LocalDocumentPagesService`
 * over HTTP: GET /pages for `list`, POST /pages/move for the reorder.
 *
 * Page identity rule (locked with the user, do not change):
 *   - Pages are addressed exclusively by their indirect
 *     `pageObjectNumber`. The wire never sends a page index for a
 *     mutation. This keeps multi-call client logic from having to
 *     account for index drift between requests.
 *   - Successful `move()` returns the full new order in `meta.affectedPages`. The server
 *     does NOT bump per-page revisions on a page move (page reorder is
 *     intentionally outside the weak-ref staleness model).
 */
export class CloudDocumentPagesService implements DocumentPagesService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly layerName: string,
    private readonly isClosed: () => boolean,
    private readonly manifest: ManifestAccessor,
  ) {}

  list(): AbortablePromise<PageListSnapshot> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<PageListSnapshot>(async (signal) => {
      const manifest = await this.manifest.get(signal);
      return { pages: manifest.pages.map((page) => ({ ...page.state })) };
    });
  }

  move(pageObjectNumbers: PageObjectNumber[], destIndex: number): AbortablePromise<PageMoveResult> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<PageMoveResult>(async (signal) => {
      const result = await this.http.postJson(
        wirePaths.layerPagesMove(this.docId, this.layerName),
        { pageObjectNumbers, destIndex },
        (raw) => PageMoveResultSchema.parse(raw),
        signal,
      );
      this.manifest.apply(result.meta);
      return result;
    });
  }
}
