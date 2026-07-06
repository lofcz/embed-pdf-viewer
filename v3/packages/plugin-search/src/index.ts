export { searchPlugin } from './search.plugin';
export { SearchToken } from './types';
export type {
  SearchCapability,
  SearchHit,
  SearchOptions,
  SearchPluginConfig,
  SearchRevealOptions,
  SearchState,
  SearchStatus,
} from './types';
// Early pattern feedback for regex-mode inputs (same validator the engine
// enforces) — so the UI can flag a bad pattern on keystroke, before a query.
export { validateSearchRegex } from '@embedpdf/engine-core/runtime';
export type { SearchRegexValidation, SearchSnippet } from '@embedpdf/engine-core/runtime';
