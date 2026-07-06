/**
 * The React surface for @embedpdf-x/plugin-search.
 *
 * <SearchLayer> is a dumb renderer, the SelectionLayer's twin: it reads
 * the page's content-space hit rects from the capability and paints them
 * through PageContext.pageToContent. The active hit gets its own colour.
 * No pointer handling, no engine calls — search is driven from app chrome
 * via useSearch().
 */
import * as React from 'react';
import { SearchToken } from '@embedpdf-x/plugin-search';
import type { SearchHit } from '@embedpdf-x/plugin-search';
import { shallowArray, useCapability, usePage, useSelector } from './runtime';

export interface SearchLayerProps {
  /** Highlight colour for hits (default: translucent yellow). */
  color?: string;
  /** Highlight colour for the ACTIVE hit (default: translucent orange). */
  activeColor?: string;
}

export function SearchLayer({
  color = 'rgba(255, 213, 0, 0.35)',
  activeColor = 'rgba(255, 132, 0, 0.55)',
}: SearchLayerProps) {
  const page = usePage();
  const hits = useSelector(SearchToken, (c) => c.hitsForPage(page.pon), shallowArray);
  const active = useSelector(SearchToken, (c) => c.activeHit());

  if (hits.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {hits.map((hit: SearchHit) =>
        hit.rects.map((r, i) => {
          const tl = page.transform.pageToContent({ x: r.x, y: r.y });
          const br = page.transform.pageToContent({ x: r.x + r.width, y: r.y + r.height });
          return (
            <div
              key={`${hit.charStart}:${i}`}
              style={{
                position: 'absolute',
                left: tl.x,
                top: tl.y,
                width: br.x - tl.x,
                height: br.y - tl.y,
                background: hit === active ? activeColor : color,
                borderRadius: 2,
              }}
            />
          );
        }),
      )}
    </div>
  );
}

/** The search capability (search/clear/next/prev/…) for app chrome. */
export function useSearch() {
  return useCapability(SearchToken);
}

/** Reactive search read-model for chrome: status, counts, progress. */
export function useSearchState() {
  const status = useSelector(SearchToken, (c) => c.status());
  const hitCount = useSelector(SearchToken, (c) => c.hitCount());
  const activeIndex = useSelector(SearchToken, (c) => c.activeIndex());
  const progress = useSelector(
    SearchToken,
    (c) => c.progress(),
    (a, b) => a.scanned === b.scanned && a.total === b.total,
  );
  const error = useSelector(SearchToken, (c) => c.errorMessage());
  return { status, hitCount, activeIndex, progress, error };
}
