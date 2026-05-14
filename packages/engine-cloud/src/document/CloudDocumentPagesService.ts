import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentPagesService,
  type PageListSnapshot,
  type PageMoveResult,
  type PageObjectNumber,
} from '@embedpdf/engine-core/runtime';
import {
  PageListSnapshotSchema,
  PageMoveResultSchema,
  wirePaths,
} from '@embedpdf/engine-core/wire';
import type { HttpClient } from '../transport/HttpClient';

/**
 * Cloud-side document pages service. Mirrors `LocalDocumentPagesService`
 * over HTTP: GET /pages for `list`, POST /pages/move for the reorder.
 *
 * Page identity rule (locked with the user, do not change):
 *   - Pages are addressed exclusively by their indirect
 *     `pageObjectNumber`. The wire never sends a page index for a
 *     mutation. This keeps multi-call client logic from having to
 *     account for index drift between requests.
 *   - Successful `move()` returns the full new `pageOrder`. The server
 *     does NOT bump per-page revisions on a page move (page reorder is
 *     intentionally outside the weak-ref staleness model).
 */
export class CloudDocumentPagesService implements DocumentPagesService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly isClosed: () => boolean,
  ) {}

  list(): AbortablePromise<PageListSnapshot> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<PageListSnapshot>(async (signal) =>
      this.http.getJson(
        wirePaths.pagesList(this.docId),
        (raw) => PageListSnapshotSchema.parse(raw),
        signal,
      ),
    );
  }

  move(pageObjectNumbers: PageObjectNumber[], destIndex: number): AbortablePromise<PageMoveResult> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<PageMoveResult>(async (signal) =>
      this.http.postJson(
        wirePaths.pagesMove(this.docId),
        { pageObjectNumbers, destIndex },
        (raw) => PageMoveResultSchema.parse(raw),
        signal,
      ),
    );
  }
}
