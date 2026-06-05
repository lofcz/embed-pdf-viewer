/**
 * @embedpdf/kernel — core contracts.
 *
 * Framework-free and serializable. The kernel understands ONE foundational thing
 * beyond plain state: **document scope**. Plugins declare a scope; the kernel
 * multiplexes document-scoped plugins per documentId so each plugin is authored as
 * if there is a single document. This is the layer reimplemented in Rust for v4.
 */

export type Unsubscribe = () => void;

/** Every state transition is a plain, serializable action. */
export interface Action {
  readonly type: string;
}

/** Kernel-emitted document-lifecycle actions; plugins may react via `onAction`. */
export const CORE_DOCUMENT_ADDED = '@@core/document-added';
export const CORE_DOCUMENT_REMOVED = '@@core/document-removed';
export const CORE_ACTIVE_CHANGED = '@@core/active-changed';

/**
 * A typed handle to a capability. The phantom `__type` carries the capability's
 * interface so resolution is typed (no string casts) — the analog of a Rust trait.
 */
export interface CapabilityToken<T> {
  readonly name: string;
  /** phantom — never present at runtime */
  readonly __type?: T;
}

export interface PageSize {
  readonly width: number;
  readonly height: number;
}

/** What the kernel knows about an open document (lightweight, synchronous, serializable). */
export interface DocumentMeta {
  readonly id: string;
  readonly name?: string;
  readonly pageCount: number;
  readonly pages: readonly PageSize[];
}

/** The document registry lives in core — it's what document scope is built on. */
export interface CoreState {
  readonly documents: Readonly<Record<string, DocumentMeta>>;
  readonly order: readonly string[];
  readonly activeId: string | null;
}

export interface GlobalState {
  readonly core: CoreState;
  readonly plugins: Readonly<Record<string, unknown>>;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** An RGBA raster (length = width*height*4), device pixels. Just bytes. */
export interface RenderResult {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Where a document comes from. Engine-specific; `id` keeps persistence stable. */
export interface OpenSource {
  id?: string;
  name?: string;
  [k: string]: unknown;
}

/**
 * The engine boundary (swappable: local-wasm | cloud-http). Tiny here; the real
 * `@embedpdf/engine` returns bitmaps via AbortablePromise. One Engine serves many
 * documents — every call is keyed by `docId`, so the kernel stays DOM-free.
 */
export interface Engine {
  open(source: OpenSource): Promise<DocumentMeta>;
  renderPage(docId: string, pageIndex: number, scale: number): RenderResult;
}

export type PluginScope = 'workspace' | 'document';

/**
 * The context a plugin receives. Document-scoped plugins get a context bound to a
 * single document (`documentId`, `document()`, and `get()` auto-binds to it), so
 * they're written as if there is one document. Workspace plugins see all documents.
 */
export interface PluginContext<S, A extends Action = Action> {
  readonly id: string;
  readonly engine: Engine;
  /** The bound document (document-scoped plugins only; undefined for workspace). */
  readonly documentId?: string;
  getState(): S;
  dispatch(action: A): void;
  subscribe(listener: () => void): Unsubscribe;
  core(): CoreState;
  /** The bound document's meta (document-scoped); for workspace plugins: the active doc, or null. */
  document(): DocumentMeta | null;
  /** Resolve a capability. Document-scoped targets bind to this context's document (or the active one). */
  get<T>(token: CapabilityToken<T>): T;
  /** Resolve a document-scoped capability for a specific document. */
  forDocument<T>(token: CapabilityToken<T>, docId: string): T;
  tryGet<T>(token: CapabilityToken<T>): T | null;
}

/** Side-effect context: the only place async/IO/cross-plugin reactions live. */
export interface EffectContext<S, A extends Action = Action> extends PluginContext<S, A> {
  watch<R>(
    select: () => R,
    handler: (value: R, previous: R) => void,
    isEqual?: (a: R, b: R) => boolean,
  ): Unsubscribe;
  onAction(type: string, handler: (action: Action) => void): Unsubscribe;
  cleanup(fn: () => void): void;
}

/**
 * A plugin definition. `scope` decides multiplexing:
 *   'workspace' (default) — one instance; can see every document.
 *   'document'            — one instance PER open document; authored single-document.
 */
export interface PluginDef<S = unknown, A extends Action = Action, C = unknown> {
  readonly id: string;
  readonly token?: CapabilityToken<C>;
  readonly scope?: PluginScope;
  readonly requires?: ReadonlyArray<CapabilityToken<unknown>>;
  readonly optional?: ReadonlyArray<CapabilityToken<unknown>>;
  readonly initialState?: S | (() => S);
  readonly reduce?: (state: S, action: A) => S;
  readonly capability?: (ctx: PluginContext<S, A>) => C;
  readonly init?: (ctx: PluginContext<S, A>) => void | Promise<void>;
  readonly effects?: (ctx: EffectContext<S, A>) => void;
}

export type AnyPlugin = PluginDef<any, any, any>;

// ── Built-in: the document registry, exposed as a capability ─────────────────

export interface DocInfo {
  id: string;
  name?: string;
  pageCount: number;
}

export interface DocumentsCapability {
  open(source: OpenSource, opts?: { activate?: boolean }): Promise<string>;
  close(id: string): Promise<void>;
  closeAll(): Promise<void>;
  setActive(id: string): void;
  activeId(): string | null;
  list(): DocInfo[];
  get(id: string): DocInfo | null;
  has(id: string): boolean;
  count(): number;
  order(): string[];
}

/** Built-in token for the document registry capability (provided by the kernel). */
export const DocumentsToken: CapabilityToken<DocumentsCapability> = { name: 'documents' };
