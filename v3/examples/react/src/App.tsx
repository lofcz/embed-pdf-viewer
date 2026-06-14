import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createCapabilityToken } from '@embedpdf-x/kernel';
import { stagePlugin } from '@embedpdf-x/plugin-stage';
import type {
  Direction,
  FlowMode,
  GridColumns,
  LayoutKind,
  SpreadMode,
  SizingMode,
  StageCapability,
  StageSettings,
} from '@embedpdf-x/plugin-stage';
import { markerPlugin } from '@embedpdf-x/plugin-marker';
import { persistPlugin } from '@embedpdf-x/plugin-persist';
import { renderPlugin } from '@embedpdf-x/plugin-render';
import { pageEditPlugin } from '@embedpdf-x/plugin-page-edit';
import { viewManagerPlugin } from '@embedpdf-x/plugin-view-manager';
import type { ViewInfo } from '@embedpdf-x/plugin-view-manager';
import {
  Viewer,
  Stage,
  DocumentScope,
  RenderLayer,
  MarkerLayer,
  MarkerMenu,
  usePage,
  useZoom,
  usePages,
  useLayout,
  useStageSettings,
  useDocuments,
  useViews,
  usePageEditor,
  useSelector,
} from '@embedpdf-x/react';
import { bootstrap, engineMode, newDocument } from './engine';
import type { Boot } from './engine';

// The Stage is a LENS: a document can be viewed through several at once. The
// sidebar is a second lens — wrapped grid, fixed thumbnail zoom — with its own
// camera per document, fully independent of the main view.
const ThumbsStageToken = createCapabilityToken<StageCapability>('stage-thumbs');

// Plugins are plain, pure values — engine-agnostic. The engine is chosen in
// ./engine and injected at the root; nothing here knows local vs cloud vs fake.
const plugins = [
  stagePlugin({ layout: 'vertical' }), // the main lens; everything tunable at runtime
  stagePlugin({
    id: 'stage-thumbs',
    token: ThumbsStageToken,
    layout: 'grid',
    columns: 'auto', // WRAPPED: re-wraps as the sidebar resizes
    sizing: 'uniform', // equalize pages so the pixel target hits every thumb
    zoom: { pageWidth: 110 }, // thumbs are 110 SCREEN px wide — for ANY document
    padding: 10,
    gap: { px: 12 }, // UI-stable spacing: 12px between thumbs in EVERY document
    pageFrame: { top: 0, right: 0, bottom: 16, left: 0 }, // reserved label band (screen px)
    fitAlign: { x: 'center', y: 'start' }, // few pages? thumbs hug the TOP, not the middle
    scrollBehavior: 'instant',
  }),
  renderPlugin(), // document-scoped: renders pages through the engine handle
  pageEditPlugin(), // document-scoped: PON-addressed rotate/move/delete over the handle
  markerPlugin(),
  // effects-only plugin: requires Stage, mirrors per-document view-state to localStorage.
  persistPlugin({ key: 'embedpdf:v3-demo' }),
  // workspace plugin: partitions open documents into reorderable panes (each pane
  // owns its own tab strip; tabs can be dragged between panes).
  viewManagerPlugin(),
];

// "Presets" are a CUSTOMER concern, not the plugin's: they're just objects of
// settings the app keeps and applies with stage.update(...). Define as many as you like.
const PRESETS: Record<string, Partial<StageSettings>> = {
  Document: {
    flow: 'continuous',
    layout: 'vertical',
    bounded: true,
    padding: 24,
    gap: 16,
    overflowAlign: { x: 'start', y: 'start' }, // arrive at the reading start (direction-aware)
    zoom: { mode: 'automatic' },
  },
  // Construction: every sheet in view on an infinite canvas, then zoom in to work.
  Canvas: {
    flow: 'continuous',
    layout: 'grid',
    bounded: false,
    padding: 24,
    gap: 56, // sheets spread out on a table
    overflowAlign: { x: 'center', y: 'center' }, // drawings: arrive centered (Drawboard feel)
    zoom: { mode: 'fit-all' },
  },
};

// Arrival alignment (overflowAlign), expressed as the combos a UI actually offers.
// The plugin keeps the orthogonal per-axis primitive; naming the useful pairs is
// the app's concern. LOGICAL: 'reading start' = top-left in LTR, top-RIGHT in RTL.
const ALIGNMENTS: Record<string, StageSettings['overflowAlign']> = {
  'reading start': { x: 'start', y: 'start' }, // where the text begins (direction-aware)
  'reading end': { x: 'end', y: 'start' }, // the far edge of the line
  center: { x: 'center', y: 'center' }, // drawings (Drawboard feel)
};

// ── drag payloads: a tab (document) or a whole pane (view) ───────────────────
type DragPayload =
  | { kind: 'doc'; documentId: string; fromViewId: string }
  | { kind: 'view'; viewId: string };

const writePayload = (e: React.DragEvent, payload: DragPayload) =>
  e.dataTransfer.setData('text/plain', JSON.stringify(payload));
const readPayload = (e: React.DragEvent): DragPayload | null => {
  try {
    return JSON.parse(e.dataTransfer.getData('text/plain')) as DragPayload;
  } catch {
    return null;
  }
};

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
  const { zoom, mode, zoomIn, zoomOut, fitWidth, fitPage, fitAll, automatic } = useZoom();
  const { currentPage, pageCount, next, prev } = usePages();
  const {
    flow,
    setFlow,
    layout,
    setLayout,
    spread,
    setSpread,
    sizing,
    setSizing,
    bounded,
    setBounded,
  } = useLayout();
  const { settings, update, reset } = useStageSettings();
  const applyZoomMode = (m: string) => {
    if (m === 'automatic') automatic();
    else if (m === 'fit-page') fitPage();
    else if (m === 'fit-width') fitWidth();
    else if (m === 'fit-all') fitAll();
  };
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 10px',
        borderBottom: '1px solid #eee',
        background: '#fafafa',
        fontSize: 12,
      }}
    >
      <button onClick={() => prev()} title="previous page/spread">
        ◀
      </button>
      <span>
        p <b>{currentPage + 1}</b>/{pageCount}
      </span>
      <button onClick={() => next()} title="next page/spread">
        ▶
      </button>
      <span style={{ width: 1, height: 18, background: '#ddd' }} />
      <select value={flow} onChange={(e) => setFlow(e.target.value as FlowMode)} title="flow">
        <option value="continuous">scroll</option>
        <option value="paged">paged</option>
      </select>
      <button onClick={zoomOut}>−</button>
      <span style={{ minWidth: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
      <button onClick={zoomIn}>+</button>
      <select value={mode} onChange={(e) => applyZoomMode(e.target.value)} title="zoom mode">
        <option value="automatic">automatic</option>
        <option value="fit-page">fit page</option>
        <option value="fit-width">fit width</option>
        <option value="fit-all">fit all</option>
        <option value="custom" disabled>
          custom
        </option>
      </select>
      <span style={{ width: 1, height: 18, background: '#ddd' }} />
      <select
        value={layout}
        onChange={(e) => setLayout(e.target.value as LayoutKind)}
        title="layout"
      >
        <option value="vertical">vertical</option>
        <option value="horizontal">horizontal</option>
        <option value="grid">grid</option>
      </select>
      <select
        value={String(settings.columns)}
        onChange={(e) => {
          const v = e.target.value;
          update({ columns: (v === 'square' || v === 'auto' ? v : Number(v)) as GridColumns });
        }}
        title="grid columns: square (≈√n), auto (WRAPPED — re-wraps with viewport width and zoom), or a fixed count"
      >
        <option value="square">▦ square</option>
        <option value="auto">▦ wrapped</option>
        <option value="1">▦ 1 col</option>
        <option value="2">▦ 2 cols</option>
        <option value="3">▦ 3 cols</option>
        <option value="4">▦ 4 cols</option>
      </select>
      <select
        value={settings.direction}
        onChange={(e) => update({ direction: e.target.value as Direction })}
        title="reading direction: RTL flips horizontal order, spread binding, grid fill, and logical alignment"
      >
        <option value="ltr">ltr</option>
        <option value="rtl">rtl</option>
      </select>
      <select
        value={spread}
        onChange={(e) => setSpread(e.target.value as SpreadMode)}
        title="spread"
      >
        <option value="none">single</option>
        <option value="odd">spread</option>
        <option value="even">spread (cover)</option>
      </select>
      <select
        value={sizing}
        onChange={(e) => setSizing(e.target.value as SizingMode)}
        title="page sizing: true sizes, or equalize the cross axis so pages sit flush"
      >
        <option value="intrinsic">true size</option>
        <option value="uniform">uniform</option>
      </select>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#555' }}
        title="clamp the camera to the content (off = free infinite pan, for plans/CAD)"
      >
        <input type="checkbox" checked={bounded} onChange={(e) => setBounded(e.target.checked)} />
        bounded{bounded ? '' : ' ∞'}
      </label>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#555' }}
        title="breathing room (px) around the content — fit inset, arrival gutter, clamp slack"
      >
        pad
        <input
          type="number"
          min={0}
          max={200}
          step={4}
          value={settings.padding}
          onChange={(e) => update({ padding: Math.max(0, Number(e.target.value) || 0) })}
          style={{ width: 48 }}
        />
      </label>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#555' }}
        title="space between pages (world units; scales with zoom) — one value for every layout"
      >
        gap
        <input
          type="number"
          min={0}
          max={200}
          step={4}
          value={typeof settings.gap === 'number' ? settings.gap : settings.gap.px}
          onChange={(e) => update({ gap: Math.max(0, Number(e.target.value) || 0) })}
          style={{ width: 48 }}
        />
      </label>
      <select
        value={
          Object.keys(ALIGNMENTS).find(
            (k) =>
              ALIGNMENTS[k].x === settings.overflowAlign.x &&
              ALIGNMENTS[k].y === settings.overflowAlign.y,
          ) ?? 'reading start'
        }
        onChange={(e) => update({ overflowAlign: ALIGNMENTS[e.target.value] })}
        title="overflowAlign: where you LAND when the page overflows — logical: 'reading start' follows the direction (top-left in LTR, top-right in RTL); center for drawings"
      >
        {Object.keys(ALIGNMENTS).map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {/* App-defined presets — just objects passed to update(). Not the plugin's concern. */}
      <span style={{ marginLeft: 'auto', width: 1, height: 18, background: '#ddd' }} />
      {Object.keys(PRESETS).map((name) => (
        <button key={name} onClick={() => update(PRESETS[name])} title={`apply the ${name} preset`}>
          {name}
        </button>
      ))}
      <button onClick={reset} title="reset to home">
        ⟲
      </button>
    </div>
  );
}

// The thumbnail sidebar: the SAME document through a second stage lens (wrapped
// grid, fixed small zoom). Drag its right edge — the grid re-wraps 1 → 2 → 3
// columns by width. Click a thumb to navigate the MAIN lens.
function ThumbnailSidebar() {
  const { currentPage, goToPage } = usePages(); // the MAIN lens
  const editor = usePageEditor(); // PERSISTED page edits (document-scoped, shared by lenses)
  const canEdit = editor.canEdit();
  const pageCount = useSelector(ThumbsStageToken, (c) => c.pageCount()); // gates move/delete edges
  const [menuPage, setMenuPage] = useState<number | null>(null); // which thumb's action menu is open
  const thumbs = useStageSettings(ThumbsStageToken); // the SIDEBAR lens
  const thumbPx = 'pageWidth' in thumbs.settings.zoom ? thumbs.settings.zoom.pageWidth : 110;
  // FOLLOW the main view (Adobe behavior): when its current page changes, make that
  // thumb visible — minimal movement, zero when it's already on screen. Policy in
  // app code; the `reveal` verb is the mechanism.
  const { reveal } = usePages(ThumbsStageToken);
  useEffect(() => reveal(currentPage), [currentPage, reveal]);
  return (
    <div
      style={{
        width: 168,
        minWidth: 84,
        maxWidth: 560,
        resize: 'horizontal',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #e2e2e2',
        background: '#f4f4f4',
      }}
      title="drag the bottom-right corner to resize — the grid re-wraps"
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 6px',
          fontSize: 11,
          color: '#666',
          borderBottom: '1px solid #e2e2e2',
        }}
        title="thumbnail width in SCREEN px — document-independent (zoom: { pageWidth })"
      >
        thumb
        <input
          type="number"
          min={40}
          max={400}
          step={10}
          value={thumbPx}
          onChange={(e) =>
            thumbs.update({ zoom: { pageWidth: Math.max(40, Number(e.target.value) || 110) } })
          }
          style={{ width: 48 }}
        />
        px
      </label>
      <Stage
        token={ThumbsStageToken}
        style={{ flex: 1, position: 'relative' }}
        pageChrome={(page) => {
          // BOX-SPACE chrome: the click target/selection border hug the CONTENT
          // box (inset by the frame), and the label sits in the reserved bottom
          // band. None of this rotates with the page content; that's the point.
          const menuOpen = menuPage === page.pageIndex;
          // Run an edit, then close the menu — a move/delete reshuffles indices,
          // so leaving it open would leave it pointing at a different page.
          const act = (e: React.MouseEvent, fn: () => void) => {
            e.stopPropagation();
            fn();
            setMenuPage(null);
          };
          const itemStyle: React.CSSProperties = {
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '5px 10px',
            border: 'none',
            background: 'transparent',
            font: 'inherit',
            fontSize: 11,
            color: '#222',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          };
          return (
            <>
              <div
                onClick={() => goToPage(page.pageIndex)}
                style={{
                  position: 'absolute',
                  top: page.frame.top,
                  left: page.frame.left,
                  right: page.frame.right,
                  bottom: page.frame.bottom,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                  border:
                    page.pageIndex === currentPage ? '3px solid #3858e9' : '1px solid #d0d0d0',
                }}
              />
              {/* Page-actions menu. Box-space, gated on the assemble permission.
                  Every edit writes through the engine, so the MAIN lens updates too. */}
              {canEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation(); // don't navigate the main lens
                    setMenuPage(menuOpen ? null : page.pageIndex);
                  }}
                  title="Page actions"
                  style={{
                    position: 'absolute',
                    top: page.frame.top + 3,
                    right: page.frame.right + 3,
                    zIndex: 12,
                    width: 20,
                    height: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    fontSize: 13,
                    lineHeight: 1,
                    border: 'none',
                    borderRadius: 4,
                    background: menuOpen ? '#1f3bb3' : 'rgba(56, 88, 233, 0.9)',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  ⋯
                </button>
              )}
              {canEdit && menuOpen && (
                <>
                  {/* click-away backdrop: `fixed` escapes the Stage's overflow:hidden */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuPage(null);
                    }}
                    style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: page.frame.top + 26,
                      right: page.frame.right + 3,
                      zIndex: 11,
                      minWidth: 128,
                      background: '#fff',
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
                      overflow: 'hidden',
                      padding: '3px 0',
                    }}
                  >
                    <button
                      style={itemStyle}
                      onClick={(e) => act(e, () => editor.rotateBy(page.pon, 90))}
                    >
                      ↻ Rotate
                    </button>
                    {/* hide "move up" on the first page; "move down" on the last */}
                    {page.pageIndex > 0 && (
                      <button
                        style={itemStyle}
                        onClick={(e) => act(e, () => editor.move([page.pon], page.pageIndex - 1))}
                      >
                        ↑ Move page up
                      </button>
                    )}
                    {page.pageIndex < pageCount - 1 && (
                      <button
                        style={itemStyle}
                        onClick={(e) => act(e, () => editor.move([page.pon], page.pageIndex + 1))}
                      >
                        ↓ Move page down
                      </button>
                    )}
                    {/* the engine rejects deleting the last remaining page */}
                    {pageCount > 1 && (
                      <button
                        style={{ ...itemStyle, color: '#c0322b' }}
                        onClick={(e) => act(e, () => editor.delete([page.pon]))}
                      >
                        🗑 Delete
                      </button>
                    )}
                  </div>
                </>
              )}
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
                  fontSize: 10,
                  color: '#666',
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
    </div>
  );
}

// One pane = one view. It owns its own tab strip (view.documentIds) and a Stage
// bound to its active document. Tabs drag within and BETWEEN panes; the grip
// (⠿) drags the whole pane to reorder.
function Pane({
  view,
  names,
  canRemove,
}: {
  view: ViewInfo;
  names: Record<string, string>;
  canRemove: boolean;
}) {
  const { open, close } = useDocuments();
  const v = useViews();
  const focused = view.id === v.focusedViewId;

  const dropDoc = (e: React.DragEvent, index: number) => {
    const payload = readPayload(e);
    if (!payload || payload.kind !== 'doc') return;
    e.stopPropagation();
    if (payload.fromViewId === view.id) v.moveDocumentWithin(view.id, payload.documentId, index);
    else v.moveDocumentBetween(payload.fromViewId, view.id, payload.documentId, index);
  };
  const dropPane = (e: React.DragEvent) => {
    const payload = readPayload(e);
    if (!payload || payload.kind !== 'view' || payload.viewId === view.id) return;
    v.moveView(
      payload.viewId,
      v.views.findIndex((x) => x.id === view.id),
    );
  };

  return (
    <div
      onMouseDown={() => v.setFocused(view.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={dropPane}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderRadius: 8,
        overflow: 'hidden',
        border: focused ? '2px solid #3858e9' : '2px solid #d8d8d8',
      }}
    >
      {/* tab strip */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => dropDoc(e, view.documentIds.length)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '4px 6px',
          background: '#f3f3f3',
          borderBottom: '1px solid #e2e2e2',
        }}
      >
        <span
          draggable
          onDragStart={(e) => writePayload(e, { kind: 'view', viewId: view.id })}
          title="drag to reorder pane"
          style={{ cursor: 'grab', color: '#bbb', padding: '0 2px' }}
        >
          ⠿
        </span>
        {view.documentIds.map((docId, i) => {
          const active = docId === view.activeDocumentId;
          return (
            <div
              key={docId}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                writePayload(e, { kind: 'doc', documentId: docId, fromViewId: view.id });
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => dropDoc(e, i)}
              onClick={() => {
                v.setFocused(view.id);
                v.setActiveDocument(view.id, docId);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 6px 3px 9px',
                borderRadius: 5,
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: 12,
                background: active ? '#fff' : 'transparent',
                border: active ? '1px solid #ccc' : '1px solid transparent',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
              }}
            >
              <span>{names[docId] ?? docId}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void close(docId);
                }}
                style={{
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#999',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          onClick={() => {
            v.setFocused(view.id);
            void newDocument().then((doc) => open(doc.source, { name: doc.name }));
          }}
          title="open a new document in this pane"
          style={{
            border: '1px dashed #bbb',
            background: 'transparent',
            borderRadius: 5,
            padding: '2px 7px',
            cursor: 'pointer',
            color: '#666',
          }}
        >
          +
        </button>
        {canRemove && (
          <button
            onClick={() => v.removeView(view.id)}
            title="close this pane (documents stay open)"
            style={{
              marginLeft: 'auto',
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              color: '#c00',
              fontSize: 12,
            }}
          >
            ✕ pane
          </button>
        )}
      </div>

      {/* body — bound to this pane's active document */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {view.activeDocumentId ? (
          <DocumentScope id={view.activeDocumentId}>
            <ThumbnailSidebar />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <Toolbar />
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
                        🗑 delete
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
            </div>
          </DocumentScope>
        ) : (
          <div
            style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#aaa', fontSize: 12 }}
          >
            empty pane — drag a tab here or press <b style={{ margin: '0 4px' }}>+</b>
          </div>
        )}
      </div>
    </div>
  );
}

function Workspace() {
  const { docs } = useDocuments();
  const { views, createView } = useViews();
  const names = useMemo(() => Object.fromEntries(docs.map((d) => [d.id, d.name ?? d.id])), [docs]);
  return (
    <div
      style={{ display: 'flex', flex: 1, minHeight: 0, gap: 6, padding: 6, background: '#e9e9e9' }}
    >
      {views.map((view) => (
        <Pane key={view.id} view={view} names={names} canRemove={views.length > 1} />
      ))}
      <button
        onClick={() => createView()}
        title="split: add another pane"
        style={{
          alignSelf: 'center',
          padding: '8px 10px',
          border: '1px dashed #bbb',
          borderRadius: 8,
          background: '#fff',
          cursor: 'pointer',
          color: '#666',
          whiteSpace: 'nowrap',
        }}
      >
        ◫ split
      </button>
    </div>
  );
}

function Shell() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        font: '13px ui-monospace, Menlo, monospace',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          borderBottom: '1px solid #eee',
        }}
      >
        <span style={{ fontWeight: 700, color: '#3858e9' }}>EmbedPDF v3</span>
        <span
          title="engine selected in ./engine — switch with ?engine=local|cloud|fake"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: '#fff',
            background:
              engineMode === 'local' ? '#1a7f37' : engineMode === 'cloud' ? '#8250df' : '#9a6700',
            borderRadius: 4,
            padding: '1px 6px',
          }}
        >
          {engineMode} engine
        </span>
        <span style={{ marginLeft: 'auto', color: '#aaa', fontSize: 11 }}>
          each pane owns its tabs · drag a tab between panes · ⠿ reorder panes · ◫ split
        </span>
      </div>
      <Workspace />
    </div>
  );
}

// Build the engine (async — wasm worker spins up, PDFs are fetched), then mount.
export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    bootstrap().then(setBoot, (e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <div style={{ padding: 24, color: '#c00', font: '13px ui-monospace, monospace' }}>
        engine failed to start: {error}
      </div>
    );
  if (!boot)
    return (
      <div style={{ padding: 24, color: '#888', font: '13px ui-monospace, monospace' }}>
        booting {engineMode} engine…
      </div>
    );

  return (
    <Viewer
      engine={boot.engine}
      plugins={plugins}
      initialDocuments={boot.documents}
      fallback={<div style={{ padding: 20 }}>opening documents…</div>}
    >
      <Shell />
    </Viewer>
  );
}
