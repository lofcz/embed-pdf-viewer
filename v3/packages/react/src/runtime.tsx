/**
 * @embedpdf/react — the generic binding.
 *
 * This file is the ENTIRE framework-specific reactivity layer: bind the kernel's
 * one change stream to React via useSyncExternalStore, expose capabilities, and
 * provide the page coordinate context. Every plugin and every layer rides on this
 * — there is no per-plugin framework code. (Vue/Svelte/Angular = this file again.)
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
import { createKernel } from '@embedpdf/kernel';
import type { AnyPlugin, CapabilityToken, Engine, Kernel } from '@embedpdf/kernel';

const KernelCtx = createContext<Kernel | null>(null);

export function useKernel(): Kernel {
  const k = useContext(KernelCtx);
  if (!k) throw new Error('useKernel must be used within <Viewer>/<EmbedPDF>');
  return k;
}

/** Resolve a capability by typed token (stable across renders). */
export function useCapability<T>(token: CapabilityToken<T>): T {
  const k = useKernel();
  return useMemo(() => k.capability(token), [k, token]);
}

export const shallowArray = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

/**
 * The one reactive read. Subscribes to the kernel's global stream and recomputes
 * a selector over a capability, caching by equality so unrelated dispatches don't
 * re-render (and so derived values keep a stable reference — no tearing loop).
 */
export function useSelector<C, R>(
  token: CapabilityToken<C>,
  select: (cap: C) => R,
  isEqual: (a: R, b: R) => boolean = Object.is,
): R {
  const k = useKernel();
  const cap = useCapability(token);
  const last = useRef<{ v: R } | null>(null);
  const get = () => {
    const next = select(cap);
    if (last.current && isEqual(last.current.v, next)) return last.current.v;
    last.current = { v: next };
    return next;
  };
  return useSyncExternalStore(k.subscribe, get, get);
}

export interface ViewerProps {
  engine: Engine;
  plugins: AnyPlugin[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/** Builds the kernel, opens the document, then provides it to the tree. */
export function Viewer({ engine, plugins, fallback, children }: ViewerProps) {
  const kernel = useMemo(() => createKernel({ engine, plugins }), [engine, plugins]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    kernel.start().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
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
  pageIndex: number;
  size: { width: number; height: number };
  scale: number;
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
  pageIndex: number,
  scale: number,
  size: { width: number; height: number },
  getRect: () => DOMRect,
): PageContextValue {
  return {
    documentId,
    pageIndex,
    size,
    scale,
    toPagePoint: (cx, cy) => {
      const r = getRect();
      return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
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
