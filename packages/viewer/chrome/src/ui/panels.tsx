/**
 * The static chrome around the toolbars: the left/right sidebars (shell
 * surfaces) and the bottom page-controls overlay. Deliberately minimal —
 * chrome-parity scope. Panels read their open state from plugin-shell; the
 * app owns their DOM.
 *
 * There is no built-in header: branding, a locale picker and a theme switch
 * are the EMBEDDER's chrome, not the viewer's. The frame keeps a `header`
 * socket for a slotted one (see Shell).
 */
import { useEffect, useState } from 'react';
import { useSelector, useDocumentId } from '@embedpdf/react/runtime';
import { Stage, StageToken, usePages } from '@embedpdf/react/stage';
import { RenderLayer } from '@embedpdf/react/render';
import { useSurface } from '@embedpdf/react/shell';
import { useT } from '@embedpdf/react/i18n';
import { useHighlightedPageRanges } from '../config-context';
import { ThumbsStageToken } from '../config/stage';
import { firstHighlightedPageIndex, pageIndexIsHighlighted } from '../page-highlights';
import { Icon } from './icons';
import { AnnotationStylePanel } from './annotation-style';
import { OutlineList } from './outline-list';
import { RedactionPanel } from './redaction-panel';
import { SearchPanel } from './search-panel';

type LeftTab = 'thumbnails' | 'outline';

// ── left sidebar (thumbnails / outline tabs) ─────────────────────────────────
export function LeftSidebar() {
  const t = useT();
  const sidebar = useSurface('sidebar');
  const [tab, setTab] = useState<LeftTab>('thumbnails');
  if (!sidebar.isOpen) return null;
  return (
    <aside className="border-border-subtle bg-surface flex w-60 shrink-0 flex-col border-r">
      <div className="border-border-subtle flex items-center gap-1 border-b p-2">
        <button
          type="button"
          onClick={() => setTab('thumbnails')}
          className={`rounded-md px-2 py-1 text-xs font-medium ${
            tab === 'thumbnails' ? 'bg-accent-light text-accent' : 'text-fg-muted'
          }`}
        >
          {t('demo.thumbnails')}
        </button>
        <button
          type="button"
          onClick={() => setTab('outline')}
          className={`rounded-md px-2 py-1 text-xs font-medium ${
            tab === 'outline' ? 'bg-accent-light text-accent' : 'text-fg-muted'
          }`}
        >
          {t('demo.outline')}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={sidebar.close}
          className="text-fg-muted hover:bg-hover grid h-7 w-7 place-items-center rounded-md"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      {tab === 'thumbnails' ? <ThumbnailList /> : <OutlineList />}
    </aside>
  );
}

// The thumbnail rail: the SAME document through the thumbnail Stage lens (a
// single-column, fixed-zoom grid — see App's `stage-thumbs` plugin). Click a
// thumb to navigate the MAIN lens; the rail follows the main view. Read-only —
// no page edits (rotate/move/delete), just the page bitmap and its number.
function ThumbnailList() {
  const { currentPage, goToPage } = usePages(); // the MAIN lens
  const { reveal } = usePages(ThumbsStageToken); // the SIDEBAR lens
  const highlighted = useHighlightedPageRanges();
  const firstCited = firstHighlightedPageIndex(highlighted);
  // Follow the main view; on a citation open, land the rail on the first cited
  // page so the marked range is in view even before the main lens reports it.
  useEffect(
    () => reveal(firstCited ?? currentPage),
    [currentPage, firstCited, reveal],
  );
  return (
    <Stage
      token={ThumbsStageToken}
      zoomGestures={false} // fixed-magnification rail: cmd+wheel/pinch scrolls, never zooms
      className="flex-1"
      style={{ position: 'relative' }}
      pageChrome={(page) => {
        const current = page.pageIndex === currentPage;
        const cited = pageIndexIsHighlighted(page.pageIndex, highlighted);
        return (
        <>
          {/* BOX-SPACE chrome: the click target + selection border hug the page
              box; the number sits in the reserved bottom band. Neither rotates. */}
          <button
            type="button"
            onClick={() => goToPage(page.pageIndex)}
            title={`Page ${page.pageIndex + 1}${cited ? ' (cited)' : ''}`}
            style={{
              position: 'absolute',
              top: page.frame.top,
              left: page.frame.left,
              right: page.frame.right,
              bottom: page.frame.bottom,
              cursor: 'pointer',
              boxSizing: 'border-box',
              borderRadius: 4,
              border: current
                ? '2px solid var(--ep-accent)'
                : cited
                  ? '2px solid var(--ep-accent)'
                  : '1px solid var(--ep-border-subtle)',
              boxShadow: current ? '0 0 0 2px var(--ep-accent-light)' : 'none',
              background: cited ? 'var(--ep-accent-light)' : undefined,
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: page.frame.bottom,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: 'var(--ep-fg-muted)',
              pointerEvents: 'none',
            }}
          >
            {page.pageIndex + 1}
          </div>
        </>
        );
      }}
    >
      {/* page-space content: the bitmap, which rotates with the page */}
      {() => <RenderLayer />}
    </Stage>
  );
}

// ── right sidebar (search / comment / style) ─────────────────────────────────
export function RightSidebar() {
  const t = useT();
  // Keys the SearchPanel below: the panel seeds its query box from the active
  // document's search state on mount, so it must remount when the active
  // document changes (switching tabs with the sidebar open) to re-seed.
  const documentId = useDocumentId();
  const search = useSurface('search');
  const comment = useSurface('comment');
  const style = useSurface('annotation-style');
  const redaction = useSurface('redaction');
  const active = search.isOpen
    ? 'search'
    : comment.isOpen
      ? 'comment'
      : style.isOpen
        ? 'style'
        : redaction.isOpen
          ? 'redaction'
          : null;
  if (!active) return null;

  const titleKey =
    active === 'search'
      ? 'demo.searchTitle'
      : active === 'comment'
        ? 'demo.commentsTitle'
        : active === 'redaction'
          ? 'demo.redactionTitle'
          : 'demo.styleTitle';
  const close =
    active === 'search'
      ? search.close
      : active === 'comment'
        ? comment.close
        : active === 'redaction'
          ? redaction.close
          : style.close;

  return (
    <aside className="border-border-subtle bg-surface flex w-72 shrink-0 flex-col border-l">
      <div className="border-border-subtle flex items-center justify-between border-b p-3">
        <span className="text-fg text-sm font-semibold">{t(titleKey)}</span>
        <button
          type="button"
          onClick={close}
          className="text-fg-muted hover:bg-hover grid h-7 w-7 place-items-center rounded-md"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      {active === 'style' ? (
        <AnnotationStylePanel />
      ) : active === 'search' ? (
        <SearchPanel key={documentId ?? 'none'} />
      ) : active === 'redaction' ? (
        <RedactionPanel />
      ) : (
        <div className="p-3">
          <p className="text-fg-muted text-sm">{t('demo.empty')}</p>
        </div>
      )}
    </aside>
  );
}

// ── bottom page-controls overlay ─────────────────────────────────────────────
export function PageControls() {
  const t = useT();
  // the Stage cursor is a 0-based display index; people count from 1
  const current = useSelector(StageToken, (c) => c.currentPage() + 1);
  const total = useSelector(StageToken, (c) => c.pageCount());
  if (!total) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
      <div className="border-border-subtle bg-elevated/95 text-fg-secondary pointer-events-auto rounded-full border px-4 py-1.5 text-sm shadow-lg backdrop-blur">
        {t('demo.page', { params: { current, total } })}
      </div>
    </div>
  );
}
