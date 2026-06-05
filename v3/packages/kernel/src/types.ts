/**
 * @embedpdf/kernel — core contracts.
 *
 * Everything here is framework-free and serializable. The kernel never imports a
 * framework or (at runtime) the DOM; rendering is a shell concern. This is the
 * layer that, in v4, gets reimplemented in Rust behind the same shapes.
 */

export type Unsubscribe = () => void;

/** Every state transition is a plain, serializable action. */
export interface Action {
  readonly type: string;
}

/**
 * A typed handle to a capability. The phantom `__type` carries the capability's
 * interface so `ctx.get(Token)` returns it with no string casts (the analog of a
 * Rust trait bound).
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

/** Minimal document descriptor the kernel owns (lifecycle lives in `core`). */
export interface PdfDocument {
  readonly id: string;
  readonly pageCount: number;
  readonly pages: readonly PageSize[];
}

export interface CoreState {
  readonly document: PdfDocument | null;
}

export interface GlobalState {
  readonly core: CoreState;
  readonly plugins: Readonly<Record<string, unknown>>;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** An RGBA raster (length = width*height*4), in device pixels. Just bytes. */
export interface RenderResult {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * The engine boundary (swappable: local-wasm | cloud-http). The real
 * `@embedpdf/engine` returns bitmaps via AbortablePromise; here it's synchronous.
 * `renderPage` returns RGBA pixels at `scale` (device px per PDF point) — the shell
 * paints them, so the kernel references ZERO DOM types and stays Rust-portable.
 */
export interface Engine {
  open(): Promise<PdfDocument>;
  renderPage(pageIndex: number, scale: number): RenderResult;
}

/**
 * The context a plugin receives. It exposes the plugin's OWN slice (get/dispatch/
 * subscribe), the shared document, the engine, and typed access to OTHER plugins'
 * capabilities. A plugin never reaches into another plugin's internals — only its
 * capability.
 */
export interface PluginContext<S, A extends Action = Action> {
  readonly id: string;
  readonly engine: Engine;
  getState(): S;
  dispatch(action: A): void;
  subscribe(listener: () => void): Unsubscribe;
  core(): CoreState;
  get<T>(token: CapabilityToken<T>): T;
}

/**
 * A plugin definition: a pure reducer + a capability factory. No inheritance, no
 * host coupling — a struct of functions, which maps 1:1 to a Rust module.
 *
 * @typeParam S - the plugin's private slice state (pure, serializable)
 * @typeParam A - its action union (pure)
 * @typeParam C - its public capability (the typed contract other code depends on)
 */
export interface PluginDef<S = unknown, A extends Action = Action, C = unknown> {
  readonly id: string;
  readonly token: CapabilityToken<C>;
  readonly initialState: S | (() => S);
  readonly reduce?: (state: S, action: A) => S;
  readonly capability: (ctx: PluginContext<S, A>) => C;
  readonly init?: (ctx: PluginContext<S, A>) => void | Promise<void>;
}

export type AnyPlugin = PluginDef<any, any, any>;
