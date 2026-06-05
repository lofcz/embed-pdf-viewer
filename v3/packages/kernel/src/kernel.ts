import { createStore } from './store';
import {
  createEffectContext,
  createPluginContext,
  sliceKey,
  type ContextServices,
} from './context';
import { planPlugins } from './order';
import {
  CORE_ACTIVE_CHANGED,
  CORE_DOCUMENT_ADDED,
  CORE_DOCUMENT_REMOVED,
  DocumentsToken,
  type Action,
  type AnyPlugin,
  type CapabilityToken,
  type CoreState,
  type DocInfo,
  type DocumentMeta,
  type DocumentsCapability,
  type Engine,
  type GlobalState,
  type OpenSource,
  type PluginScope,
  type Unsubscribe,
} from './types';

export interface Kernel {
  readonly engine: Engine;
  readonly documents: DocumentsCapability;
  /** Resolve a capability. For document-scoped tokens, `documentId` defaults to the active doc. */
  capability<T>(token: CapabilityToken<T>, documentId?: string): T;
  /** A token's scope — adapters use this to decide whether to bind a document. */
  scopeOf(token: CapabilityToken<unknown>): PluginScope;
  subscribe(listener: () => void): Unsubscribe;
  getState(): GlobalState;
  start(): Promise<void>;
  destroy(): void;
}

const isDocumentScoped = (plugin: AnyPlugin) => plugin.scope === 'document';
const initialStateOf = (plugin: AnyPlugin): unknown =>
  typeof plugin.initialState === 'function'
    ? (plugin.initialState as () => unknown)()
    : (plugin.initialState ?? {});
const reducerOf = (plugin: AnyPlugin) =>
  (plugin.reduce ?? ((state: unknown) => state)) as (state: unknown, action: Action) => unknown;
const toDocInfo = (meta: DocumentMeta): DocInfo => ({
  id: meta.id,
  name: meta.name,
  pageCount: meta.pageCount,
});

/**
 * Assemble a kernel from an engine + plugins.
 *
 *   planPlugins        — validate dependencies, order them
 *   resolveCapability  — workspace singletons, or per-document instances built lazily
 *   document lifecycle — bring up / tear down document-scoped plugins as docs open/close
 *   start / destroy    — run workspace init+effects; clean everything up
 */
export function createKernel(opts: { engine: Engine; plugins: AnyPlugin[] }): Kernel {
  const { engine, plugins } = opts;
  const store = createStore();
  const plan = planPlugins(plugins);
  const documentScopedPlugins = plan.ordered.filter(isDocumentScoped);

  // One workspace instance per token; one per-(plugin, document) instance, built lazily.
  const workspaceCapabilities = new Map<CapabilityToken<unknown>, unknown>();
  const documentCapabilities = new Map<string, unknown>();
  const workspaceTeardowns: Array<() => void> = [];
  const documentTeardowns = new Map<string, Array<() => void>>();

  const registerTeardown = (teardown: () => void, documentId?: string) => {
    if (documentId) documentTeardowns.get(documentId)?.push(teardown);
    else workspaceTeardowns.push(teardown);
  };

  function resolveCapability<T>(token: CapabilityToken<T>, documentId?: string): T {
    const workspaceCapability = workspaceCapabilities.get(token);
    if (workspaceCapability) return workspaceCapability as T;
    const provider = plan.providerOf(token);
    if (!provider) throw new Error(`No capability "${token.name}".`);
    const id = documentId ?? store.getCore().activeId;
    if (!id) throw new Error(`Capability "${token.name}" requires an active document.`);
    return buildDocumentCapability(provider, id) as T;
  }

  const services: ContextServices = { engine, store, resolveCapability, registerTeardown };

  function buildDocumentCapability(plugin: AnyPlugin, documentId: string): unknown {
    const key = sliceKey(plugin.id, documentId);
    let capability = documentCapabilities.get(key);
    if (!capability) {
      capability = plugin.capability!(createPluginContext(services, plugin, documentId));
      documentCapabilities.set(key, capability);
    }
    return capability;
  }

  // ── document lifecycle ───────────────────────────────────────────────────────
  function nextActiveDocument(core: CoreState, removedId: string): string | null {
    if (core.activeId !== removedId) return core.activeId;
    const index = core.order.indexOf(removedId);
    const remaining = core.order.filter((id) => id !== removedId);
    return remaining.length === 0 ? null : (remaining[Math.max(0, index - 1)] ?? remaining[0]);
  }

  async function openDocument(
    source: OpenSource,
    options?: { activate?: boolean },
  ): Promise<string> {
    const meta = await engine.open(source);
    const core = store.getCore();
    const activate = (options?.activate ?? true) || core.activeId === null;
    store.setCore(
      {
        documents: { ...core.documents, [meta.id]: meta },
        order: [...core.order, meta.id],
        activeId: activate ? meta.id : core.activeId,
      },
      { type: CORE_DOCUMENT_ADDED },
    );
    // bring up every document-scoped plugin for this document
    documentTeardowns.set(meta.id, []);
    for (const plugin of documentScopedPlugins) {
      store.registerSlice(sliceKey(plugin.id, meta.id), reducerOf(plugin), initialStateOf(plugin));
    }
    for (const plugin of documentScopedPlugins) {
      await plugin.init?.(createPluginContext(services, plugin, meta.id));
    }
    for (const plugin of documentScopedPlugins) {
      plugin.effects?.(createEffectContext(services, plugin, meta.id));
    }
    return meta.id;
  }

  async function closeDocument(documentId: string): Promise<void> {
    (documentTeardowns.get(documentId) ?? []).forEach((teardown) => teardown());
    documentTeardowns.delete(documentId);
    for (const plugin of documentScopedPlugins) {
      documentCapabilities.delete(sliceKey(plugin.id, documentId));
      store.removeSlice(sliceKey(plugin.id, documentId));
    }
    const core = store.getCore();
    if (!core.documents[documentId]) return;
    const { [documentId]: _removed, ...documents } = core.documents;
    store.setCore(
      {
        documents,
        order: core.order.filter((id) => id !== documentId),
        activeId: nextActiveDocument(core, documentId),
      },
      { type: CORE_DOCUMENT_REMOVED },
    );
  }

  const documents: DocumentsCapability = {
    open: openDocument,
    close: closeDocument,
    closeAll: async () => {
      for (const id of [...store.getCore().order]) await closeDocument(id);
    },
    setActive: (id) => {
      if (store.getCore().documents[id])
        store.setCore({ activeId: id }, { type: CORE_ACTIVE_CHANGED });
    },
    activeId: () => store.getCore().activeId,
    list: (): DocInfo[] =>
      store.getCore().order.map((id) => toDocInfo(store.getCore().documents[id])),
    get: (id) => {
      const meta = store.getCore().documents[id];
      return meta ? toDocInfo(meta) : null;
    },
    has: (id) => store.getCore().documents[id] !== undefined,
    count: () => store.getCore().order.length,
    order: () => [...store.getCore().order],
  };
  workspaceCapabilities.set(DocumentsToken, documents);

  // ── workspace plugins: seed slices, then build their capabilities ────────────
  for (const plugin of plan.ordered) {
    if (!isDocumentScoped(plugin))
      store.registerSlice(plugin.id, reducerOf(plugin), initialStateOf(plugin));
  }
  for (const plugin of plan.ordered) {
    if (!isDocumentScoped(plugin) && plugin.token && plugin.capability) {
      workspaceCapabilities.set(
        plugin.token,
        plugin.capability(createPluginContext(services, plugin)),
      );
    }
  }

  return {
    engine,
    documents,
    capability: resolveCapability,
    scopeOf: plan.scopeOf,
    subscribe: store.subscribe,
    getState: store.getState,
    start: async () => {
      for (const plugin of plan.ordered) {
        if (!isDocumentScoped(plugin)) await plugin.init?.(createPluginContext(services, plugin));
      }
      for (const plugin of plan.ordered) {
        if (!isDocumentScoped(plugin)) plugin.effects?.(createEffectContext(services, plugin));
      }
    },
    destroy: () => {
      for (const teardowns of documentTeardowns.values())
        teardowns.forEach((teardown) => teardown());
      documentTeardowns.clear();
      while (workspaceTeardowns.length) workspaceTeardowns.pop()!();
    },
  };
}
