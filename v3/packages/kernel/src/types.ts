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

/** Dispatched by the kernel after the document opens. Plugins may react to it. */
export const CORE_DOCUMENT_LOADED = '@@core/document-loaded';

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
 *
 * NOTE: `get`/`tryGet` resolve capabilities lazily — call them inside methods or
 * effects, never at capability-construction time.
 */
export interface PluginContext<S, A extends Action = Action> {
  readonly id: string;
  readonly engine: Engine;
  getState(): S;
  dispatch(action: A): void;
  subscribe(listener: () => void): Unsubscribe;
  core(): CoreState;
  /** Resolve a required capability. Throws if absent. */
  get<T>(token: CapabilityToken<T>): T;
  /** Resolve an optional capability, or null if its plugin isn't registered. */
  tryGet<T>(token: CapabilityToken<T>): T | null;
}

/**
 * The richer context an `effects` function receives: the plugin context plus the
 * three side-effect primitives. This is the ONLY place async/IO/cross-plugin
 * reactions live — the reducer stays pure.
 */
export interface EffectContext<S, A extends Action = Action> extends PluginContext<S, A> {
  /** Run `handler` whenever the selected value changes. Auto-torn-down on destroy. */
  watch<R>(
    select: () => R,
    handler: (value: R, previous: R) => void,
    isEqual?: (a: R, b: R) => boolean,
  ): Unsubscribe;
  /** Run `handler` after any action of `type` is dispatched anywhere. */
  onAction(type: string, handler: (action: Action) => void): Unsubscribe;
  /** Register teardown to run on `kernel.destroy()`. */
  cleanup(fn: () => void): void;
}

/**
 * A plugin definition: a pure reducer + a capability factory + optional effects.
 * No inheritance, no host coupling — a struct of functions, which maps 1:1 to a
 * Rust module. Everything but `id` is optional, so a plugin can be:
 *   • state + capability  (e.g. stage, marker)
 *   • effects-only        (e.g. persist, telemetry — no public surface)
 *
 * @typeParam S - private slice state (pure, serializable)
 * @typeParam A - action union (pure)
 * @typeParam C - public capability (the typed contract others depend on)
 */
export interface PluginDef<S = unknown, A extends Action = Action, C = unknown> {
  readonly id: string;
  readonly token?: CapabilityToken<C>;
  /** Capabilities this plugin needs. Validated at startup; orders init/effects. */
  readonly requires?: ReadonlyArray<CapabilityToken<unknown>>;
  /** Capabilities this plugin uses if present. Never errors if absent. */
  readonly optional?: ReadonlyArray<CapabilityToken<unknown>>;
  readonly initialState?: S | (() => S);
  readonly reduce?: (state: S, action: A) => S;
  readonly capability?: (ctx: PluginContext<S, A>) => C;
  readonly init?: (ctx: PluginContext<S, A>) => void | Promise<void>;
  readonly effects?: (ctx: EffectContext<S, A>) => void;
}

export type AnyPlugin = PluginDef<any, any, any>;
