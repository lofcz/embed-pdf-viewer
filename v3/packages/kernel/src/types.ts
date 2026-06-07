/**
 * @embedpdf-x/kernel — core contracts.
 *
 * Framework-free and serializable. The engine boundary is the REAL one:
 * `@embedpdf/engine-core`'s `Engine`/`DocumentHandle` — implemented identically by
 * local-wasm (`@embedpdf/engine`), cloud (`@cloudpdf/engine`), and the test fake.
 * The kernel adds *document scope*: plugins declare a scope and the kernel
 * multiplexes document-scoped plugins per document.
 */
import type {
  DocumentHandle,
  Engine,
  OpenInput,
  OpenOptions,
  PageLayout,
  PageObjectNumber,
} from '@embedpdf/engine-core/runtime';

// re-export the engine contracts so consumers import them from @embedpdf-x/kernel
export type { DocumentHandle, Engine, OpenInput, OpenOptions, PageLayout, PageObjectNumber };

export type Unsubscribe = () => void;

/** Every state transition is a plain, serializable action. */
export interface Action {
  readonly type: string;
}

/** Kernel-emitted document-lifecycle actions; plugins may react via `onAction`. */
export const CORE_DOCUMENT_ADDED = '@@core/document-added';
export const CORE_DOCUMENT_REMOVED = '@@core/document-removed';
export const CORE_ACTIVE_CHANGED = '@@core/active-changed';
export const CORE_ORDER_CHANGED = '@@core/order-changed';

/** A typed handle to a capability — typed resolution, no string casts. */
export interface CapabilityToken<T> {
  readonly name: string;
  /** phantom — never present at runtime */
  readonly __type?: T;
}

/**
 * What the kernel knows about an open document — the page registry captured at open.
 * `pages` is the engine's own snapshot (`PageLayout`: index, pageObjectNumber, size,
 * rotation, label, boxes). The `pageObjectNumber` (pon) is the durable per-page
 * identity; the array index is only display order.
 */
export interface DocumentMeta {
  readonly id: string;
  readonly name?: string;
  readonly pageCount: number;
  readonly pages: readonly PageLayout[];
}

/** The document registry — what document scope is built on. */
export interface CoreState {
  readonly documents: Readonly<Record<string, DocumentMeta>>;
  readonly order: readonly string[];
  readonly activeId: string | null;
}

export interface GlobalState {
  readonly core: CoreState;
  readonly plugins: Readonly<Record<string, unknown>>;
}

export type PluginScope = 'workspace' | 'document';

/**
 * The context a plugin receives. Document-scoped plugins get a context bound to a
 * single document — `documentId`, `document()` (metadata), `doc` (the engine handle),
 * and `get()` resolving document-scoped capabilities for it.
 */
export interface PluginContext<S, A extends Action = Action> {
  readonly id: string;
  readonly engine: Engine;
  /** The bound document (document-scoped plugins only; undefined for workspace). */
  readonly documentId?: string;
  /** The bound document's engine handle; for workspace plugins, the active doc's handle, or null. */
  readonly doc: DocumentHandle | null;
  getState(): S;
  dispatch(action: A): void;
  subscribe(listener: () => void): Unsubscribe;
  core(): CoreState;
  /** The bound document's metadata; for workspace plugins, the active doc's, or null. */
  document(): DocumentMeta | null;
  get<T>(token: CapabilityToken<T>): T;
  forDocument<T>(token: CapabilityToken<T>, documentId: string): T;
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

/** Options for opening a document: kernel concerns (activate/name) + engine OpenOptions. */
export type OpenDocumentOptions = OpenOptions & { activate?: boolean; name?: string };

export interface DocumentsCapability {
  open(input: OpenInput, options?: OpenDocumentOptions): Promise<string>;
  close(id: string): Promise<void>;
  closeAll(): Promise<void>;
  setActive(id: string): void;
  activeId(): string | null;
  list(): DocInfo[];
  get(id: string): DocInfo | null;
  has(id: string): boolean;
  count(): number;
  order(): string[];
  /** Move a document (tab) to a new position in the order. */
  move(id: string, toIndex: number): void;
  /** Swap two documents (tabs) in the order. */
  swap(a: string, b: string): void;
}

/** Built-in token for the document registry capability (provided by the kernel). */
export const DocumentsToken: CapabilityToken<DocumentsCapability> = { name: 'documents' };
