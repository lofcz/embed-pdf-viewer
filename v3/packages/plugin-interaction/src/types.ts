import { createCapabilityToken, type PageObjectNumber } from '@embedpdf-x/kernel';
import type { Point } from '@embedpdf-x/geometry';

export type ToolId = string;
export type Cursor = string;

export interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

/**
 * The single active arbiter of what the pointer does. `pan` and `pointer` are
 * built in; features add more (`highlight`, `square`, `redact`…) via
 * `registerTool`. A tool carries no behaviour itself — it turns on capability
 * TAGS that handlers opt into (`enables`), so tools compose features without
 * coupling to them.
 */
export interface Tool {
  id: ToolId;
  cursor: Cursor;
  enables: ReadonlySet<string>;
}

export type Phase = 'down' | 'move' | 'up';

/**
 * One normalized pointer event. `viewport` is the source container's px (the pan
 * handler uses the delta). `page` is the resolved page hit — its `pon` + content
 * point (y-down, PDF units, via the page's transform) — present when the pointer
 * is over a page, absent over gaps. A viewport source (Stage) resolves `page` per
 * event (so a drag can cross pages); a per-page source (PageView) always sets it.
 */
export interface PointerSample {
  phase: Phase;
  viewport: Point;
  page?: { pon: PageObjectNumber; point: Point };
  modifiers: Modifiers;
  /**
   * Click count for a `down` (1 = single, 2 = double, 3 = triple), from the
   * browser's native multi-click detection (`MouseEvent.detail`). Lets handlers
   * do word/line selection without re-implementing timing. Defaults to 1.
   */
  clickCount?: number;
}

/**
 * A pointer handler contributed by a feature plugin. The ONE registration
 * mechanism (replacing v2's registerMode / registerHandlers / registerAlways /
 * enableForMode quartet): a handler declares which tools it's live under and a
 * priority; the hub routes each gesture to the first handler that captures it.
 */
export interface InteractionHandler {
  id: string;
  /** Higher wins the gesture. */
  priority: number;
  /** Usually `tool.enables.has('my-tag')`. */
  enabledFor(tool: Tool): boolean;
  /** Return true to CAPTURE: subsequent move/up route here until pointer-up. */
  onDown(sample: PointerSample): boolean;
  onMove?(sample: PointerSample): void;
  onUp?(sample: PointerSample): void;
  /** Pointer moved with no active gesture — cursor feedback only. */
  onHover?(sample: PointerSample): void;
}

export interface InteractionState {
  activeToolId: ToolId;
  cursor: Cursor;
}

export type InteractionAction =
  | { type: 'SET_TOOL'; toolId: ToolId }
  | { type: 'SET_CURSOR'; cursor: Cursor };

export interface InteractionCapability {
  // ── selectors ──
  activeTool(): Tool;
  activeToolId(): ToolId;
  cursor(): Cursor;
  tools(): Tool[];
  // ── tool intents ──
  activateTool(id: ToolId): void;
  /** Fires after the active tool changes — lets a feature react (e.g. a markup
   *  tool taking over the selection visual). Returns an unsubscribe fn. */
  onToolChange(cb: () => void): () => void;
  // ── registries (return an unregister fn) ──
  registerTool(tool: Tool): () => void;
  registerHandler(handler: InteractionHandler): () => void;
  // ── cursor claim stack (highest priority wins; null clears the token) ──
  setCursor(token: string, cursor: Cursor | null, priority?: number): void;
  // ── pointer ingress: the adapter calls this for every normalized event ──
  dispatch(sample: PointerSample): void;
}

export const InteractionToken = createCapabilityToken<InteractionCapability>('interaction');

export interface InteractionConfig {
  /** Tool active when a document opens. Default `'pointer'`. */
  defaultTool?: ToolId;
}
