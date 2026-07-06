import {
  AbortablePromise,
  EngineError,
  EngineErrorCode,
  type DocumentSearchService,
  type SearchRequest,
  type SearchSlice,
} from '@embedpdf/engine-core/runtime';

/**
 * Cloud search transport. Server-side by design: the corpus and geometry
 * never cross the trust boundary — the client sends a query and receives
 * match slices from the layer's search route.
 *
 * The route ships with the server search phase; until then every call
 * rejects with `NotImplemented` (the documented "typed but not yet wired"
 * signal), so viewers can feature-detect and hide the search UI instead
 * of breaking.
 */
export class CloudDocumentSearchService implements DocumentSearchService {
  query(_request: SearchRequest): AbortablePromise<SearchSlice> {
    return AbortablePromise.rejectReason(
      new EngineError(
        EngineErrorCode.NotImplemented,
        'cloud search is not wired yet: the server search route lands with the corpus phase',
      ),
    );
  }
}
