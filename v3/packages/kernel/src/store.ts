import type { Action, CoreState, GlobalState, Unsubscribe } from './types';

/**
 * The store: one state tree ({ core, plugins }), pure per-plugin reducers, and two
 * notification channels — `subscribe` (state changed) for reactivity/`watch`, and
 * `subscribeAction` (an action was dispatched) for `onAction` effects.
 */
export interface Store {
  registerSlice(id: string, reducer: (s: unknown, a: Action) => unknown, initial: unknown): void;
  getSlice(id: string): unknown;
  getCore(): CoreState;
  getState(): GlobalState;
  dispatchTo(id: string, action: Action): void;
  setCore(patch: Partial<CoreState>, action: Action): void;
  subscribe(listener: () => void): Unsubscribe;
  subscribeAction(listener: (action: Action) => void): Unsubscribe;
}

export function createStore(): Store {
  let core: CoreState = { document: null };
  const slices: Record<string, unknown> = {};
  const reducers: Record<string, (s: unknown, a: Action) => unknown> = {};
  const changeListeners = new Set<() => void>();
  const actionListeners = new Set<(a: Action) => void>();

  // Non-re-entrant change notification. If a listener dispatches (e.g. an effect
  // reacting to a change), we don't fire listeners nested mid-flight — we finish the
  // current pass and run another. This keeps listener order deterministic (a later
  // effect always observes an earlier effect's writes) and avoids re-entrancy bugs.
  let emitting = false;
  let pending = false;
  const emitChange = () => {
    if (emitting) {
      pending = true;
      return;
    }
    emitting = true;
    try {
      do {
        pending = false;
        changeListeners.forEach((l) => l());
      } while (pending);
    } finally {
      emitting = false;
    }
  };
  const emitAction = (a: Action) => actionListeners.forEach((l) => l(a));

  return {
    registerSlice(id, reducer, initial) {
      reducers[id] = reducer;
      slices[id] = initial;
    },
    getSlice: (id) => slices[id],
    getCore: () => core,
    getState: () => ({ core, plugins: slices }),
    dispatchTo(id, action) {
      const r = reducers[id];
      if (!r) return;
      const next = r(slices[id], action);
      if (next !== slices[id]) {
        slices[id] = next;
        emitChange();
      }
      emitAction(action);
    },
    setCore(patch, action) {
      core = { ...core, ...patch };
      emitChange();
      emitAction(action);
    },
    subscribe(listener) {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },
    subscribeAction(listener) {
      actionListeners.add(listener);
      return () => void actionListeners.delete(listener);
    },
  };
}
