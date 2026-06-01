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
 *   - Successful `move()` returns the new `layout` (order + geometry) plus
 *     cloud coherence pins. The server does NOT bump per-page revisions on a
 *     page move (page reorder is intentionally outside the weak-ref staleness
 *     model), only `docVersion` + `layoutVersion`.
 */
export class CloudDocumentPagesService implements DocumentPagesService {
  constructor(
    private readonly http: HttpClient,
    private readonly docId: string,
    private readonly layerName: string,
    private readonly isClosed: () => boolean,
    private readonly manifest: ManifestAccessor,
  ) {}

  /**
   * Page-geometry list. The geometry bytes live at the content-addressed
   * `/layout@layoutVersion=N` leaf (not in the manifest); the manifest only
   * publishes the `layoutVersion` pointer. So `list()` reads `layoutVersion`
   * from the cached manifest, fetches the layout leaf, and on a 404 (stale
   * pointer) transparently refreshes the manifest and retries once — the
   * same ladder the per-page text/geometry reads use. `layoutVersion` bumps
   * only on structural page ops, so this leaf stays cached across content
   * and annotation edits.
   */
  list(): AbortablePromise<PageListSnapshot> {
    if (this.isClosed()) {
      return AbortablePromise.rejectReason(
        new EngineError(EngineErrorCode.DocNotOpen, `document ${this.docId} is closed`),
      );
    }
    return AbortablePromise.run<PageListSnapshot>(async (signal) => {
      const buildPath = async (s: AbortSignal): Promise<string> => {
        const manifest = await this.manifest.get(s);
        return wirePaths.layerLayout(this.docId, this.layerName, manifest.layoutVersion);
      };
      return this.http.getJsonWithRefresh(
        buildPath,
        (raw) => PageListSnapshotSchema.parse(raw),
        async (s) => {
          await this.manifest.refresh(s);
        },
        signal,
      );
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
      // A move only advances docVersion + layoutVersion (no per-page pin
      // changes), so the cached manifest can be patched in place — no refetch.
      if (result.cache) this.manifest.applyPageMove(result.cache);
      return result;
    });
  }
}
