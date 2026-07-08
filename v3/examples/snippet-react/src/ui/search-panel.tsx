/**
 * The search panel — the v2 snippet's search sidebar, rebuilt on the v3
 * plugin-search capability. v2 kept the query/flags/results IN the plugin
 * state; v3's search state is leaner (status + counts + activeIndex only), so
 * the raw input text and option flags live here as local state and every
 * change re-issues `search(text, options)`. Results stream in — the list
 * updates slice by slice while `status === 'searching'`.
 *
 * Data flow:
 *   type / toggle → (debounced) search(text, { matchCase, wholeWord })
 *   useSearchState() → status / hitCount / activeIndex (reactive chrome)
 *   useSelector(SearchToken, c => c.hits()) → the streamed hit list
 *   click a hit / prev / next → goTo/prev/next (capability reveals it on-page)
 *
 * The look is ported 1:1 from viewers/snippet's search-sidebar (magnifier
 * input with clear button, case/whole-word checkboxes, results-found counter
 * with prev/next, per-page grouped snippet list with the match bolded and the
 * active hit accented), retinted to this app's semantic tokens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch, useSearchState, SearchToken } from '@embedpdf-x/react/search';
import type { SearchHit, SearchSnippet } from '@embedpdf-x/react/search';
import { useSelector } from '@embedpdf-x/react/runtime';
import { useT } from '@embedpdf-x/react/i18n';
import { Icon } from './icons';
import { buttonClass } from './toolbar';

const DEBOUNCE_MS = 300;

// ── option checkbox (v2's peer-checked custom box) ───────────────────────────
function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="text-fg-secondary flex cursor-pointer select-none items-center gap-2 text-xs font-medium">
      <span className="relative flex h-4 w-4 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="border-border bg-surface checked:border-accent checked:bg-accent peer h-4 w-4 shrink-0 appearance-none rounded-[3px] border transition-colors"
        />
        <svg
          viewBox="0 0 24 24"
          className="text-on-accent pointer-events-none absolute h-3 w-3 opacity-0 peer-checked:opacity-100"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      {label}
    </label>
  );
}

// ── one result row: a snippet with the match bolded, active = accented ───────
function renderSnippet(s: SearchSnippet | undefined) {
  if (!s) return null;
  const end = s.matchStart + s.matchLength;
  return (
    <>
      {s.text.slice(0, s.matchStart)}
      <span className="text-accent font-semibold">{s.text.slice(s.matchStart, end)}</span>
      {s.text.slice(end)}
    </>
  );
}

function HitLine({
  hit,
  active,
  onClick,
}: {
  hit: SearchHit;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Keep the active hit visible as prev/next walks the list.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={`w-full rounded border p-2 text-left text-sm transition-colors ${
        active
          ? 'border-accent bg-accent-light text-fg'
          : 'border-border-subtle bg-surface text-fg-secondary hover:bg-hover'
      }`}
    >
      <span>{renderSnippet(hit.snippet)}</span>
    </button>
  );
}

// ── the panel ────────────────────────────────────────────────────────────────
export function SearchPanel() {
  const t = useT();
  const search = useSearch();
  const { status, hitCount, activeIndex } = useSearchState();
  const hits = useSelector(SearchToken, (c) => c.hits());

  const [input, setInput] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRun = useRef(true);

  // Debounced query. Skip the mount pass when the box is empty: the panel can
  // be closed and reopened (plugin state persists) — firing search('') then
  // would wipe results the user left running. A manual clear (input → '') is
  // NOT the mount pass, so it still clears as expected.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (input === '') return;
    }
    const id = setTimeout(() => search.search(input, { matchCase, wholeWord }), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input, matchCase, wholeWord, search]);

  // Group hits by page, preserving page order, for the sectioned list.
  const grouped = useMemo(() => {
    const map = new Map<number, { hit: SearchHit; index: number }[]>();
    hits.forEach((hit, index) => {
      const arr = map.get(hit.pageIndex);
      if (arr) arr.push({ hit, index });
      else map.set(hit.pageIndex, [{ hit, index }]);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [hits]);

  const searching = status === 'searching';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        {/* input: magnifier + clear */}
        <div className="relative">
          <div className="text-fg-muted pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
            <Icon name="search" size={16} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={input}
            placeholder={t('demo.searchPlaceholder')}
            onChange={(e) => setInput(e.target.value)}
            className="border-border bg-surface text-fg focus:border-accent focus:ring-accent w-full rounded-md border py-1.5 pl-8 pr-9 text-sm outline-none focus:ring-1"
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput('');
                inputRef.current?.focus();
              }}
              className="text-fg-muted hover:text-fg-secondary absolute inset-y-0 right-0 flex items-center pr-2.5"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>

        {/* options */}
        <div className="mt-3 flex flex-col gap-2">
          <Checkbox
            label={t('demo.searchCaseSensitive')}
            checked={matchCase}
            onChange={setMatchCase}
          />
          <Checkbox label={t('demo.searchWholeWord')} checked={wholeWord} onChange={setWholeWord} />
        </div>

        <hr className="border-border-subtle mb-2 mt-4" />

        {/* results counter + prev/next */}
        {status !== 'idle' && (
          <div className="flex h-8 items-center justify-between">
            <div className="text-fg-muted text-xs">
              {hitCount === 0
                ? t(searching ? 'demo.searchSearching' : 'demo.searchNoResults')
                : t('demo.searchResults', { params: { count: hitCount } })}
            </div>
            {hitCount > 1 && (
              <div className="flex items-center">
                <button
                  type="button"
                  title="Previous"
                  className={buttonClass(false)}
                  onClick={() => search.prev()}
                >
                  <Icon name="chevronLeft" size={20} />
                </button>
                <button
                  type="button"
                  title="Next"
                  className={buttonClass(false)}
                  onClick={() => search.next()}
                >
                  <Icon name="chevronRight" size={20} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* per-page grouped results */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {grouped.map(([pageIndex, items]) => (
          <div key={pageIndex} className="mt-2 first:mt-0">
            <div className="bg-surface/80 text-fg-muted py-2 text-xs backdrop-blur">
              {t('demo.searchPage', { params: { page: pageIndex + 1 } })}
            </div>
            <div className="flex flex-col gap-2">
              {items.map(({ hit, index }) => (
                <HitLine
                  key={index}
                  hit={hit}
                  active={index === activeIndex}
                  onClick={() => search.goTo(index)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
