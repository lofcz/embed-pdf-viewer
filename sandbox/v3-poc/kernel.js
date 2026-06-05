// @ts-check
/**
 * @embedpdf/kernel (proof of concept)
 *
 * The pure, framework-free runtime. It knows nothing about the DOM, React, or any
 * specific plugin. It owns:
 *   • a state tree: { core, plugins: { [id]: slice } }
 *   • pure per-plugin reducers
 *   • typed capability tokens + a registry (service locator, no string casts)
 *   • document lifecycle (core)
 *
 * A plugin is a plain descriptor (definePlugin). Its public surface is a
 * capability: { getState, subscribe, ...methods } — the neutral reactive contract
 * every framework adapter binds to. Synchronous + serializable => Rust/Crux-ready.
 */

/**
 * @template T
 * @typedef {{ name: string, __type?: T }} CapabilityToken<T>
 */

/** @template T @param {string} name @returns {CapabilityToken<T>} */
export function createCapabilityToken(name) {
  return { name };
}

/** @param {any} spec */
export function definePlugin(spec) {
  return spec;
}

function createStore() {
  let state = { core: { document: null }, plugins: /** @type {Record<string, any>} */ ({}) };
  const reducers = /** @type {Record<string, Function>} */ ({});
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => l());
  return {
    registerSlice(id, reducer, initial) {
      reducers[id] = reducer;
      state = { ...state, plugins: { ...state.plugins, [id]: initial } };
    },
    dispatchTo(id, action) {
      const r = reducers[id];
      if (!r) return;
      const next = r(state.plugins[id], action);
      if (next !== state.plugins[id]) {
        state = { ...state, plugins: { ...state.plugins, [id]: next } };
        emit();
      }
    },
    setCore(patch) {
      state = { ...state, core: { ...state.core, ...patch } };
      emit();
    },
    getCore: () => state.core,
    getSlice: (id) => state.plugins[id],
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/**
 * @param {{ engine: any, plugins: any[] }} opts
 */
export function createKernel({ engine, plugins }) {
  const store = createStore();
  const caps = new Map();

  for (const p of plugins) {
    const initial =
      typeof p.initialState === 'function' ? p.initialState() : (p.initialState ?? {});
    store.registerSlice(p.id, p.reduce ?? ((s) => s), initial);
  }

  for (const p of plugins) {
    // The context a plugin gets: its own slice (get/dispatch/subscribe), the core
    // document, the engine, and lazy access to OTHER plugins' capabilities by token.
    const ctx = {
      id: p.id,
      engine,
      getState: () => store.getSlice(p.id),
      dispatch: (action) => store.dispatchTo(p.id, action),
      subscribe: (l) => store.subscribe(l),
      core: () => store.getCore(),
      get: (token) => {
        const c = caps.get(token);
        if (!c) throw new Error(`capability "${token?.name}" not available`);
        return c;
      },
    };
    const methods = p.capability ? p.capability(ctx) : {};
    // Every capability satisfies the neutral reactive contract:
    caps.set(p.token, { getState: ctx.getState, subscribe: ctx.subscribe, ...methods });
    p.__ctx = ctx;
  }

  return {
    engine,
    store,
    capability(token) {
      const c = caps.get(token);
      if (!c) throw new Error(`no capability "${token?.name}"`);
      return c;
    },
    async start() {
      const doc = await engine.open();
      store.setCore({ document: doc });
      for (const p of plugins) if (p.init) await p.init(p.__ctx);
    },
  };
}
