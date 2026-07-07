/**
 * The static chrome around the toolbars: header (brand + locale + theme),
 * the left/right sidebars (shell surfaces), and the bottom page-controls
 * overlay. Deliberately minimal — chrome-parity scope. Panels read their
 * open state from plugin-shell; the app owns their DOM.
 */
import { useLocale, useT, useSurface, useSelector, useCommands } from '@embedpdf-x/react';
import { StageToken } from '@embedpdf-x/plugin-stage';
import { Icon } from './icons';
import { useTheme } from './theme';

// ── header ───────────────────────────────────────────────────────────────────
export function Header() {
  const t = useT();
  const { locale, locales, loading, setLocale } = useLocale();
  const { mode, toggle } = useTheme();
  return (
    <header className="border-border-subtle bg-surface flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <div className="flex items-center gap-2">
        <div className="bg-accent text-on-accent grid h-7 w-7 place-items-center rounded-md">
          <Icon name="book2" size={18} />
        </div>
        <div className="leading-tight">
          <div className="text-fg text-sm font-bold">{t('demo.title')}</div>
          <div className="text-fg-muted text-[11px]">{t('demo.subtitle')}</div>
        </div>
      </div>

      <div className="flex-1" />

      <label className="text-fg-muted flex items-center gap-1.5 text-xs">
        {t('demo.language')}
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          className="border-border-subtle bg-surface text-fg-secondary h-8 rounded-md border px-2"
        >
          {locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
              {loading === l.code ? ' …' : ''}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={toggle}
        title={t('demo.theme')}
        className="border-border-subtle text-fg-secondary hover:bg-hover grid h-8 w-8 place-items-center rounded-md border"
      >
        <Icon name={mode === 'dark' ? 'eye' : 'eyeOff'} size={18} />
      </button>
    </header>
  );
}

// ── left sidebar (thumbnails / outline tabs) ─────────────────────────────────
export function LeftSidebar() {
  const t = useT();
  const sidebar = useSurface('sidebar');
  if (!sidebar.isOpen) return null;
  return (
    <aside className="border-border-subtle bg-surface flex w-60 shrink-0 flex-col border-r">
      <div className="border-border-subtle flex items-center gap-1 border-b p-2">
        <span className="bg-accent-light text-accent rounded-md px-2 py-1 text-xs font-medium">
          {t('demo.thumbnails')}
        </span>
        <span className="text-fg-muted rounded-md px-2 py-1 text-xs font-medium">
          {t('demo.outline')}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={sidebar.close}
          className="text-fg-muted hover:bg-hover grid h-7 w-7 place-items-center rounded-md"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <ThumbnailList />
    </aside>
  );
}

function ThumbnailList() {
  const commands = useCommands();
  const pages = useSelector(
    StageToken,
    (c) => c.pages(),
    (a, b) => a.length === b.length,
  );
  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="flex flex-col gap-3">
        {pages.map((p) => (
          <button
            key={p.pon}
            type="button"
            onClick={() => commands.execute('pointer:toggle')}
            className="group flex flex-col items-center gap-1"
          >
            <div className="border-border-subtle bg-surface-alt text-fg-muted group-hover:border-accent grid h-28 w-full place-items-center rounded-md border text-xs">
              {p.index}
            </div>
            <span className="text-fg-muted text-[11px]">{p.label ?? p.index}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── right sidebar (search / comment / style) ─────────────────────────────────
export function RightSidebar() {
  const t = useT();
  const search = useSurface('search');
  const comment = useSurface('comment');
  const style = useSurface('annotation-style');
  const active = search.isOpen
    ? 'search'
    : comment.isOpen
      ? 'comment'
      : style.isOpen
        ? 'style'
        : null;
  if (!active) return null;

  const titleKey =
    active === 'search'
      ? 'demo.searchTitle'
      : active === 'comment'
        ? 'demo.commentsTitle'
        : 'demo.styleTitle';
  const close =
    active === 'search' ? search.close : active === 'comment' ? comment.close : style.close;

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
      <div className="p-3">
        {active === 'search' ? (
          <div className="border-border-subtle flex items-center gap-2 rounded-md border px-2">
            <Icon name="search" size={16} />
            <input
              placeholder={t('demo.searchPlaceholder')}
              className="text-fg h-9 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        ) : (
          <p className="text-fg-muted text-sm">{t('demo.empty')}</p>
        )}
      </div>
    </aside>
  );
}

// ── bottom page-controls overlay ─────────────────────────────────────────────
export function PageControls() {
  const t = useT();
  const current = useSelector(StageToken, (c) => c.currentPage());
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
