/**
 * @embedpdf-x/react — the generic binding.
 *
 * Binds the kernel's one change stream to React (useSyncExternalStore), resolves
 * capabilities (document-scoped ones against the active or `<DocumentScope>`-given
 * document), and provides the page coordinate context. Every plugin and layer rides
 * on this — there is no per-plugin framework code.
 */
import * as React from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createKernel } from '@embedpdf-x/kernel';
import type { AnyPlugin, CapabilityToken, Engine, Kernel, OpenInput } from '@embedpdf-x/kernel';
// Pure coordinate math from the geometry base — NOT from stage-core. The
// PageContext seam stays stage-agnostic (it must also serve standalone PageView).
import { screenToPagePoint, NO_FRAME, type PageFrame } from '@embedpdf-x/geometry';

const KernelCtx = createContext<Kernel | null>(null);
/** The document a subtree is bound to. null => use the active document. */
const DocumentScopeCtx = createContext<string | null>(null);

export function useKernel(): Kernel {
  const k = useContext(KernelCtx);
  if (!k) throw new Error('useKernel must be used within <Viewer>/<EmbedPDF>');
  return k;
}

export const shallowArray = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

/** Read a value derived from the kernel, cached by equality (no tearing loop). */
export function useKernelValue<R>(
  select: (k: Kernel) => R,
  isEqual: (a: R, b: R) => boolean = Object.is,
): R {
  const kernel = useKernel();
  const last = useRef<{ v: R } | null>(null);
  const get = () => {
    const next = select(kernel);
    if (last.current && isEqual(last.current.v, next)) return last.current.v;
    last.current = { v: next };
    return next;
  };
  return useSyncExternalStore(kernel.subscribe, get, get);
}

export function useActiveDocumentId(): string | null {
  return useKernelValue((k) => k.documents.activeId());
}

/** The document id for this subtree: the nearest <DocumentScope>, else the active doc. */
export function useDocumentId(): string | null {
  const scoped = useContext(DocumentScopeCtx);
  const active = useActiveDocumentId();
  return scoped ?? active;
}

export interface DocumentScopeProps {
  id: string;
  children: React.ReactNode;
}
/** Bind a subtree to a specific document (panes, comparison). */
export function DocumentScope({ id, children }: DocumentScopeProps) {
  return <DocumentScopeCtx.Provider value={id}>{children}</DocumentScopeCtx.Provider>;
}

/** Resolve a capability by token, binding document-scoped ones to this subtree's document. */
export function useCapability<T>(token: CapabilityToken<T>): T {
  const kernel = useKernel();
  const scoped = useContext(DocumentScopeCtx);
  const active = useActiveDocumentId();
  const isDocScoped = kernel.scopeOf(token) === 'document';
  const docId = isDocScoped ? (scoped ?? active ?? undefined) : undefined;
  return useMemo(() => kernel.capability(token, docId), [kernel, token, docId]);
}

/** Subscribe to a selector over a (document-resolved) capability. */
export function useSelector<C, R>(
  token: CapabilityToken<C>,
  select: (cap: C) => R,
  isEqual: (a: R, b: R) => boolean = Object.is,
): R {
  const kernel = useKernel();
  const cap = useCapability(token);
  const last = useRef<{ v: R } | null>(null);
  const get = () => {
    const next = select(cap);
    if (last.current && isEqual(last.current.v, next)) return last.current.v;
    last.current = { v: next };
    return next;
  };
  return useSyncExternalStore(kernel.subscribe, get, get);
}

/** The document registry (open/close/active/list), reactive. */
export function useDocuments() {
  const kernel = useKernel();
  const docs = useKernelValue(
    (k) => k.documents.list(),
    (a, b) =>
      a.length === b.length &&
      a.every((d, i) => d.id === b[i].id && d.pageCount === b[i].pageCount),
  );
  const activeId = useActiveDocumentId();
  return {
    docs,
    activeId,
    open: kernel.documents.open,
    close: kernel.documents.close,
    setActive: kernel.documents.setActive,
    move: kernel.documents.move,
    swap: kernel.documents.swap,
  };
}

export interface InitialDocument {
  source: OpenInput;
  name?: string;
}

export interface ViewerProps {
  engine: Engine;
  plugins: AnyPlugin[];
  /** Documents to open on startup (with optional tab names). */
  initialDocuments?: InitialDocument[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/** Builds the kernel, starts it, opens the initial documents, then renders. */
export function Viewer({ engine, plugins, initialDocuments, fallback, children }: ViewerProps) {
  const kernel = useMemo(() => createKernel({ engine, plugins }), [engine, plugins]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      await kernel.start();
      for (const doc of initialDocuments ?? []) {
        await kernel.documents.open(doc.source, { name: doc.name });
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
      kernel.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);
  return (
    <KernelCtx.Provider value={kernel}>{ready ? children : (fallback ?? null)}</KernelCtx.Provider>
  );
}
export const EmbedPDF = Viewer;

/**
 * PageContext — the seam. A layer depends ONLY on this, never on the Stage. So the
 * same layer works inside a virtualized Stage and in a standalone <PageView>.
 */
export interface PageContextValue {
  documentId: string;
  /** Durable page identity (PDF object number) — use for keys / render / annotations. */
  pon: number;
  /** Display index (page N) — use for ordering / human-facing page numbers. */
  pageIndex: number;
  /** The page content's on-screen size (un-rotated footprint, screen px). */
  size: { width: number; height: number };
  scale: number;
  /**
   * Reserved chrome bands around the page (screen px per side). The page-chrome
   * slot renders into the outer box (content + frame); these thicknesses size
   * the bands — a label in the bottom band is `bottom:0; height: frame.bottom`.
   */
  frame: PageFrame;
  toPagePoint(clientX: number, clientY: number): { x: number; y: number };
  rectStyle(rect: { x: number; y: number; width: number; height: number }): React.CSSProperties;
}

const PageCtx = createContext<PageContextValue | null>(null);
export const PageProvider = PageCtx.Provider;

export function usePage(): PageContextValue {
  const c = useContext(PageCtx);
  if (!c) throw new Error('usePage must be used inside <PageView> or a <Stage> page');
  return c;
}

export function makePageContext(
  documentId: string,
  pon: number,
  pageIndex: number,
  scale: number,
  size: { width: number; height: number },
  getRect: () => DOMRect,
  /** The surface's display rotation. `size` is the UN-rotated content size, so
   *  layers position in page coordinates and the surface's CSS rotation carries
   *  them visually; only `toPagePoint` must invert the rotation. */
  rotation: 0 | 90 | 180 | 270 = 0,
  /** Reserved chrome bands around the page (screen px) — surfaced for the
   *  page-chrome slot to size its bands. */
  frame: PageFrame = NO_FRAME,
): PageContextValue {
  return {
    documentId,
    pon,
    pageIndex,
    size,
    scale,
    frame,
    toPagePoint: (cx, cy) => {
      // The rect is the rotated wrapper's axis-aligned bounding box; its center
      // is rotation-invariant. The pure rotation/scale inverse lives in the
      // geometry base so it's verified once for every framework adapter (not
      // re-derived, and mis-derived, per port).
      const r = getRect();
      return screenToPagePoint({
        screen: { x: cx, y: cy },
        center: { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 },
        contentSize: size,
        scale,
        rotation,
      });
    },
    rectStyle: (rect) => ({
      position: 'absolute',
      left: rect.x * scale,
      top: rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    }),
  };
}
