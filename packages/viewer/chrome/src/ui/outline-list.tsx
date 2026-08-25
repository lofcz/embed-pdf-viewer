/**
 * Outline tree for the left sidebar. v3 has no bookmark plugin, so chrome
 * ships the v2 active-path helpers and this list — without a catalog outline
 * API the tree stays empty (the Outline tab is a stub). When bookmarks are
 * supplied, the deepest heading ≤ the current page is highlighted, its
 * ancestors expand, and it scrolls into view.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePages } from '@embedpdf/react/stage';
import { useT } from '@embedpdf/react/i18n';
import {
  getActiveBookmarkPath,
  resolveBookmarkDestination,
  type OutlineBookmark,
} from '../outline';
import { Icon } from './icons';

const EMPTY_BOOKMARKS: readonly OutlineBookmark[] = [];

export function OutlineList({
  bookmarks = EMPTY_BOOKMARKS,
}: {
  bookmarks?: readonly OutlineBookmark[];
}) {
  const t = useT();
  const { currentPage, goToPage } = usePages();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    () => new Set(bookmarks.map((_, index) => `${index}`)),
  );
  const activeRef = useRef<HTMLDivElement | null>(null);

  const activePath = useMemo(
    () => getActiveBookmarkPath(bookmarks, currentPage),
    [bookmarks, currentPage],
  );
  const activeId = activePath ? activePath.join('.') : null;

  // Auto-expand the active entry's ancestors so it is always revealed.
  useEffect(() => {
    if (!activePath || activePath.length <= 1) return;
    setExpandedItems((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (let i = 1; i < activePath.length; i++) {
        const ancestorId = activePath.slice(0, i).join('.');
        if (!next.has(ancestorId)) {
          next.add(ancestorId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeId, activePath]);

  // Bring the active entry into view when it changes (or after ancestors expand).
  // `block: 'nearest'` is a no-op when the entry is already visible.
  useEffect(() => {
    if (!activeId) return;
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId, expandedItems]);

  const handleClick = (bookmark: OutlineBookmark) => {
    const target = bookmark.target;
    if (target?.type === 'action' && (target.action.type === 3 || target.action.type === 'uri')) {
      if ('uri' in target.action) window.open(target.action.uri, '_blank');
      return;
    }
    const destination = resolveBookmarkDestination(bookmark);
    if (!destination) return;
    goToPage(destination.pageIndex, { behavior: 'smooth' });
  };

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderBookmark = (
    bookmark: OutlineBookmark,
    path: number[],
    level = 0,
  ): ReactNode => {
    const id = path.join('.');
    const hasChildren = Boolean(bookmark.children && bookmark.children.length > 0);
    const isExpanded = expandedItems.has(id);
    const isActive = id === activeId;

    return (
      <div key={id} className="select-none">
        <div
          ref={isActive ? activeRef : undefined}
          aria-current={isActive ? 'true' : undefined}
          className={`flex cursor-pointer items-center gap-1 px-2 py-1 ${
            isActive ? 'bg-selected' : 'hover:bg-hover'
          }`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => handleClick(bookmark)}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(id);
              }}
              className="grid h-4 w-4 place-items-center"
            >
              <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={12} />
            </button>
          ) : (
            <div className="w-4" />
          )}
          <span className={`text-sm ${isActive ? 'text-accent font-medium' : 'text-fg-secondary'}`}>
            {bookmark.title}
          </span>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {bookmark.children?.map((child, childIndex) =>
              renderBookmark(child, [...path, childIndex], level + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-fg-muted text-center">
          <div className="text-sm">{t('demo.outlineEmpty')}</div>
          <div className="mt-1 text-xs">{t('demo.outlineNoBookmarks')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="outline-tree">
        {bookmarks.map((bookmark, index) => renderBookmark(bookmark, [index]))}
      </div>
    </div>
  );
}
