import { createStore } from './store';
import {
  CORE_DOCUMENT_LOADED,
  type Action,
  type AnyPlugin,
  type CapabilityToken,
  type EffectContext,
  type Engine,
  type GlobalState,
  type PluginContext,
  type Unsubscribe,
} from './types';

export interface Kernel {
  readonly engine: Engine;
  /** Resolve a capability by typed token. Throws if the providing plugin is absent. */
  capability<T>(token: CapabilityToken<T>): T;
  /** One global change stream. Adapters bind framework reactivity to this. */
  subscribe(listener: () => void): Unsubscribe;
  getState(): GlobalState;
  /** Opens the document, seeds core, runs plugin `init`s then `effects` (in dep order). */
  start(): Promise<void>;
  /** Tear down all effects (watch/onAction/cleanup). */
  destroy(): void;
}

/**
 * Build a kernel from an engine + a flat list of plugins.
 *
 * Pipeline: validate `requires` → topologically order by dependencies → build
 * capabilities → (on start) load doc → run `init`s → wire `effects`. One store,
 * one change stream; capabilities are the sole cross-plugin surface.
 */
export function createKernel(opts: { engine: Engine; plugins: AnyPlugin[] }): Kernel {
  const { engine, plugins } = opts;
  const store = createStore();
  const caps = new Map<CapabilityToken<unknown>, unknown>();
  const ctxById = new Map<string, PluginContext<unknown>>();
  const teardowns: Array<() => void> = [];

  // ── 1. seed slices ──────────────────────────────────────────────────────────
  for (const p of plugins) {
    const initial =
      typeof p.initialState === 'function'
        ? (p.initialState as () => unknown)()
        : (p.initialState ?? {});
    store.registerSlice(
      p.id,
      (p.reduce ?? ((s: unknown) => s)) as (s: unknown, a: Action) => unknown,
      initial,
    );
  }

  // ── 2. validate `requires` + topologically order by dependencies ────────────
  const providerByToken = new Map<CapabilityToken<unknown>, AnyPlugin>();
  for (const p of plugins) if (p.token && p.capability) providerByToken.set(p.token, p);

  for (const p of plugins) {
    for (const req of p.requires ?? []) {
      if (!providerByToken.has(req)) {
        throw new Error(
          `Plugin "${p.id}" requires capability "${req.name}", which no plugin provides.`,
        );
      }
    }
  }

  const sorted: AnyPlugin[] = [];
  const mark = new Map<string, 0 | 1>(); // 0 = visiting, 1 = done
  const visit = (p: AnyPlugin) => {
    const s = mark.get(p.id);
    if (s === 1) return;
    if (s === 0) throw new Error(`Dependency cycle involving plugin "${p.id}".`);
    mark.set(p.id, 0);
    for (const tok of [...(p.requires ?? []), ...(p.optional ?? [])]) {
      const dep = providerByToken.get(tok);
      if (dep && dep !== p) visit(dep);
    }
    mark.set(p.id, 1);
    sorted.push(p);
  };
  for (const p of plugins) visit(p);

  // ── 3. build contexts + capabilities (deps first) ───────────────────────────
  const makeCtx = (p: AnyPlugin): PluginContext<unknown> => ({
    id: p.id,
    engine,
    getState: () => store.getSlice(p.id),
    dispatch: (action) => store.dispatchTo(p.id, action),
    subscribe: store.subscribe,
    core: store.getCore,
    get: <T>(token: CapabilityToken<T>): T => {
      const c = caps.get(token as CapabilityToken<unknown>);
      if (!c) throw new Error(`Capability "${token.name}" not available.`);
      return c as T;
    },
    tryGet: <T>(token: CapabilityToken<T>): T | null =>
      (caps.get(token as CapabilityToken<unknown>) as T) ?? null,
  });

  for (const p of sorted) {
    const ctx = makeCtx(p);
    ctxById.set(p.id, ctx);
    if (p.token && p.capability) caps.set(p.token, p.capability(ctx));
  }

  // EffectContext = PluginContext + the three side-effect primitives.
  const makeEffectCtx = (ctx: PluginContext<unknown>): EffectContext<unknown> => ({
    ...ctx,
    watch: (select, handler, isEqual = Object.is) => {
      let prev = select();
      const unsub = store.subscribe(() => {
        const next = select();
        if (!isEqual(prev, next)) {
          const p = prev;
          prev = next;
          handler(next, p);
        }
      });
      teardowns.push(unsub);
      return unsub;
    },
    onAction: (type, handler) => {
      const unsub = store.subscribeAction((a) => {
        if (a.type === type) handler(a);
      });
      teardowns.push(unsub);
      return unsub;
    },
    cleanup: (fn) => void teardowns.push(fn),
  });

  return {
    engine,
    capability: <T>(token: CapabilityToken<T>): T => {
      const c = caps.get(token as CapabilityToken<unknown>);
      if (!c) throw new Error(`No capability "${token.name}".`);
      return c as T;
    },
    subscribe: store.subscribe,
    getState: store.getState,
    start: async () => {
      store.setCore({ document: await engine.open() }, { type: CORE_DOCUMENT_LOADED });
      for (const p of sorted) await p.init?.(ctxById.get(p.id)!);
      for (const p of sorted) p.effects?.(makeEffectCtx(ctxById.get(p.id)!));
    },
    destroy: () => {
      while (teardowns.length) teardowns.pop()!();
    },
  };
}
