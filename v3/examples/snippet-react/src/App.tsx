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
import { commands } from './config/commands';
import { demoToolsPlugin } from './config/demo-tools.plugin';
import { en } from './locales/en';
import { ThemeProvider } from './ui/theme';
import { Shell } from './Shell';

const plugins = [
  stagePlugin({ layout: 'vertical', interaction: true }),
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
