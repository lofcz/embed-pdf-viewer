/**
 * Root. Builds the plugin set (plain pure values), boots a non-blocking engine,
 * and mounts the shell. The chrome — toolbars, translations, theme — renders at
 * t≈0; only the pages wait on the wasm engine.
 */
import { useEffect, useMemo } from 'react';
import { Viewer, useDocuments, useT } from '@embedpdf-x/react';
import { stagePlugin } from '@embedpdf-x/plugin-stage';
import { renderPlugin } from '@embedpdf-x/plugin-render';
import { pageEditPlugin } from '@embedpdf-x/plugin-page-edit';
import { interactionPlugin } from '@embedpdf-x/plugin-interaction';
import { selectionPlugin } from '@embedpdf-x/plugin-selection';
import { annotationPlugin } from '@embedpdf-x/plugin-annotation';
import { i18nPlugin, negotiateLocale } from '@embedpdf-x/plugin-i18n';
import { commandsPlugin } from '@embedpdf-x/plugin-commands';
import { shellPlugin } from '@embedpdf-x/plugin-shell';
import { createDeferredEngine, loadInitialDocuments } from './engine';
import { ThumbsStageToken } from './config/stage';
import { commands } from './config/commands';
import { demoToolsPlugin } from './config/demo-tools.plugin';
import { en } from './locales/en';
import { ThemeProvider } from './ui/theme';
import { Shell } from './Shell';

const plugins = [
  stagePlugin({ layout: 'vertical', interaction: true }), // main lens; drives the interaction hub
  // Thumbnail lens over the SAME document: a single-column grid at a fixed small
  // zoom, its own camera. Click a thumb to navigate the main lens; the sidebar
  // follows the main view (see ui/panels ThumbnailList).
  stagePlugin({
    id: 'stage-thumbs',
    token: ThumbsStageToken,
    layout: 'grid',
    columns: 1, // single column, like the v2 snippet's thumbnail rail
    sizing: 'uniform', // equalize pages so the pixel target hits every thumb
    zoom: { pageWidth: 150 }, // thumbs are 150 SCREEN px wide — for ANY document
    padding: 12,
    gap: { px: 16 }, // UI-stable spacing between thumbs
    pageFrame: { top: 0, right: 0, bottom: 20, left: 0 }, // reserved label band (screen px)
    fitAlign: { x: 'center', y: 'start' }, // few pages? thumbs hug the TOP
    scrollBehavior: 'instant',
  }),
  renderPlugin(),
  pageEditPlugin(),
  interactionPlugin({ defaultTool: 'pointer' }),
  selectionPlugin(),
  annotationPlugin(),
  demoToolsPlugin(),
  i18nPlugin({
    locale: negotiateLocale(['en', 'es'], navigator.languages) ?? 'en',
    fallbackLocale: 'en',
    locales: [en],
    loaders: { es: () => import('./locales/es').then((m) => m.es) },
  }),
  commandsPlugin({ commands }),
  shellPlugin(),
];

function Booting() {
  const t = useT();
  return (
    <div className="bg-app text-fg-muted grid h-full place-items-center">
      <div className="animate-pulse text-sm">{t('demo.starting')}</div>
    </div>
  );
}

/** Opens the sample documents once the kernel is up (bytes fetched lazily). */
function OpenInitialDocuments() {
  const { open, docs } = useDocuments();
  useEffect(() => {
    if (docs.length > 0) return;
    let alive = true;
    (async () => {
      const initial = await loadInitialDocuments();
      if (!alive) return;
      for (const doc of initial) await open(doc.source, { name: doc.name });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function App() {
  const engine = useMemo(createDeferredEngine, []);
  return (
    <ThemeProvider>
      <Viewer engine={engine} plugins={plugins} fallback={<Booting />}>
        <OpenInitialDocuments />
        <Shell />
      </Viewer>
    </ThemeProvider>
  );
}
