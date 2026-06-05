import * as React from 'react';
import { createFakeEngine } from '@embedpdf/engine-fake';
import { stagePlugin } from '@embedpdf/plugin-stage';
import type { LayoutKind } from '@embedpdf/plugin-stage';
import { markerPlugin } from '@embedpdf/plugin-marker';
import { persistPlugin } from '@embedpdf/plugin-persist';
import {
  Viewer,
  Stage,
  PageView,
  RenderLayer,
  MarkerLayer,
  MarkerMenu,
  usePage,
  useZoom,
  usePages,
  useLayout,
} from '@embedpdf/react';

// Engine + plugins are plain values. Plugins are pure; the engine is swappable.
const engine = createFakeEngine({ pages: 12 });
const plugins = [
  stagePlugin({ layout: 'vertical', framing: 'document' }),
  markerPlugin(),
  // effects-only plugin: requires Stage, mirrors view-state to localStorage.
  // Reload the page and you land on the same page/zoom/layout.
  persistPlugin({ key: 'embedpdf:v3-demo' }),
];

// A user-defined layer — no SDK involvement, just reads PageContext.
function WatermarkLayer() {
  const page = usePage();
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          transform: 'rotate(-28deg)',
          fontSize: page.size.width * 0.13,
          fontWeight: 800,
          color: 'rgba(220,0,0,0.10)',
        }}
      >
        DRAFT
      </div>
    </div>
  );
}

function Toolbar() {
  const { zoom, zoomIn, zoomOut, fitWidth } = useZoom();
  const { currentPage, pageCount, goToPage } = usePages();
  const { layout, setLayout } = useLayout();
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #e2e2e2',
        background: '#fafafa',
      }}
    >
      <strong style={{ color: '#3858e9' }}>EmbedPDF v3</strong>
      <button onClick={() => goToPage(currentPage - 1)}>◀</button>
      <span>
        page <b>{currentPage + 1}</b> / {pageCount}
      </span>
      <button onClick={() => goToPage(currentPage + 1)}>▶</button>
      <span style={{ width: 1, height: 20, background: '#ddd' }} />
      <button onClick={zoomOut}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button onClick={zoomIn}>+</button>
      <button onClick={fitWidth}>fit width</button>
      <span style={{ width: 1, height: 20, background: '#ddd' }} />
      <label>
        layout{' '}
        <select value={layout} onChange={(e) => setLayout(e.target.value as LayoutKind)}>
          <option value="vertical">vertical</option>
          <option value="horizontal">horizontal</option>
          <option value="grid">grid / canvas</option>
        </select>
      </label>
      <span style={{ marginLeft: 'auto', color: '#888' }}>
        double-click a page to drop a marker
      </span>
    </div>
  );
}

export function App() {
  return (
    <Viewer
      engine={engine}
      plugins={plugins}
      fallback={<div style={{ padding: 20 }}>loading…</div>}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          font: '13px ui-monospace, Menlo, monospace',
        }}
      >
        <Toolbar />
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* The viewer: YOU compose the layers per page. The Stage only positions. */}
          <Stage
            style={{ flex: 1, background: '#0d1117' }}
            overlay={
              <MarkerMenu>
                {({ remove }) => (
                  <button
                    onClick={remove}
                    style={{
                      background: '#ff3b30',
                      color: '#fff',
                      border: 0,
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    🗑 delete marker
                  </button>
                )}
              </MarkerMenu>
            }
          >
            {() => (
              <>
                <RenderLayer />
                <WatermarkLayer />
                <MarkerLayer />
              </>
            )}
          </Stage>

          {/* Standalone: the SAME layers on one page, with no Stage at all. */}
          <aside
            style={{ width: 300, borderLeft: '1px solid #e2e2e2', padding: 16, overflow: 'auto' }}
          >
            <h3 style={{ marginTop: 0 }}>Standalone &lt;PageView/&gt;</h3>
            <p style={{ color: '#666' }}>No Stage — no scroll/zoom/camera. A blog-post embed.</p>
            <PageView page={2} width={250}>
              <RenderLayer />
              <WatermarkLayer />
            </PageView>
          </aside>
        </div>
      </div>
    </Viewer>
  );
}
