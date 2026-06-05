import type {
  Action,
  AnyPlugin,
  CapabilityToken,
  CoreState,
  Engine,
  GlobalState,
  PluginContext,
  Unsubscribe,
} from './types';

export interface Kernel {
  readonly engine: Engine;
  /** Resolve a capability by typed token. Throws if the providing plugin is absent. */
  capability<T>(token: CapabilityToken<T>): T;
  /** One global change stream. Adapters bind framework reactivity to this. */
  subscribe(listener: () => void): Unsubscribe;
  getState(): GlobalState;
  /** Opens the document, seeds core state, runs plugin `init`s. */
  start(): Promise<void>;
}

/**
 * Build a kernel from an engine + a flat list of plugins.
 *
 * There is exactly one store and one change stream. Each plugin owns a slice
 * updated only by its own pure reducer; capabilities are the sole cross-plugin
 * surface. That single-source-of-truth is what makes the whole thing predictable
 * and portable.
 */
export function createKernel(opts: { engine: Engine; plugins: AnyPlugin[] }): Kernel {
  const { engine, plugins } = opts;

  let core: CoreState = { document: null };
  const slices: Record<string, unknown> = {};
  const reducers: Record<string, (s: unknown, a: Action) => unknown> = {};
  const caps = new Map<CapabilityToken<unknown>, unknown>();
  const contexts: Array<{ p: AnyPlugin; ctx: PluginContext<unknown> }> = [];

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (l: () => void): Unsubscribe => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };

  // 1. seed slices + reducers
  for (const p of plugins) {
    slices[p.id] =
      typeof p.initialState === 'function' ? (p.initialState as () => unknown)() : p.initialState;
    reducers[p.id] = (p.reduce ?? ((s: unknown) => s)) as (s: unknown, a: Action) => unknown;
  }

  // 2. build contexts + capabilities (capability methods read live state lazily,
  //    and `ctx.get` resolves other capabilities lazily — so order is irrelevant)
  for (const p of plugins) {
    const ctx: PluginContext<unknown> = {
      id: p.id,
      engine,
      getState: () => slices[p.id],
      dispatch: (action) => {
        const next = reducers[p.id](slices[p.id], action);
        if (next !== slices[p.id]) {
          slices[p.id] = next;
          emit();
        }
      },
      subscribe,
      core: () => core,
      get: <T>(token: CapabilityToken<T>): T => {
        const c = caps.get(token as CapabilityToken<unknown>);
        if (!c) throw new Error(`capability "${token.name}" not available`);
        return c as T;
      },
    };
    caps.set(p.token, p.capability(ctx));
    contexts.push({ p, ctx });
  }

  return {
    engine,
    capability: <T>(token: CapabilityToken<T>): T => {
      const c = caps.get(token as CapabilityToken<unknown>);
      if (!c) throw new Error(`no capability "${token.name}"`);
      return c as T;
    },
    subscribe,
    getState: (): GlobalState => ({ core, plugins: slices }),
    start: async () => {
      core = { document: await engine.open() };
      emit();
      for (const { p, ctx } of contexts) await p.init?.(ctx);
    },
  };
}
