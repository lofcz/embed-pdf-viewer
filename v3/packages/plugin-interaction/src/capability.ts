import type { PluginContext } from '@embedpdf-x/kernel';
import type {
  Cursor,
  InteractionAction,
  InteractionCapability,
  InteractionHandler,
  InteractionState,
  PointerSample,
  Tool,
  ToolId,
} from './types';

interface Claim {
  cursor: Cursor;
  priority: number;
}

/**
 * The interaction hub. Tools + handlers + the captured-gesture owner + cursor
 * claims live in this closure (runtime registries, not serializable state); the
 * reducer state holds only the active tool id and the resolved cursor, so the UI
 * can react to them. The router (`dispatch`) is the heart: on down, the first
 * eligible handler (by priority) to return true OWNS the gesture; move/up route
 * to it; with no owner, move is hover (cursor feedback).
 */
export function createInteractionCapability(
  ctx: PluginContext<InteractionState, InteractionAction>,
  builtinTools: Tool[],
): InteractionCapability {
  const tools = new Map<ToolId, Tool>();
  for (const t of builtinTools) tools.set(t.id, t);
  const handlers: InteractionHandler[] = [];
  const claims = new Map<string, Claim>();
  const toolCbs = new Set<() => void>();
  const pointerCbs = new Set<(sample: PointerSample) => void>();
  let owner: InteractionHandler | null = null;

  const toolOf = (id: ToolId): Tool =>
    tools.get(id) ?? { id, cursor: 'default', enables: new Set() };
  const active = (): Tool => toolOf(ctx.getState().activeToolId);

  const resolveCursor = (): Cursor => {
    let top: Claim | null = null;
    for (const c of claims.values()) if (!top || c.priority > top.priority) top = c;
    return top ? top.cursor : active().cursor;
  };
  const syncCursor = (): void => {
    const next = resolveCursor();
    if (next !== ctx.getState().cursor) ctx.dispatch({ type: 'SET_CURSOR', cursor: next });
  };

  const eligible = (): InteractionHandler[] => {
    const tool = active();
    return handlers.filter((h) => h.enabledFor(tool)).sort((a, b) => b.priority - a.priority);
  };

  return {
    activeTool: active,
    activeToolId: () => ctx.getState().activeToolId,
    cursor: () => ctx.getState().cursor,
    tools: () => [...tools.values()],

    activateTool: (id) => {
      if (!tools.has(id)) throw new Error(`[interaction] unknown tool '${id}'`);
      owner = null;
      claims.clear(); // drop the previous tool's hover claims; handlers re-claim on next hover
      ctx.dispatch({ type: 'SET_TOOL', toolId: id });
      syncCursor();
      toolCbs.forEach((cb) => cb());
    },

    onToolChange: (cb) => {
      toolCbs.add(cb);
      return () => toolCbs.delete(cb);
    },

    onPointer: (cb) => {
      pointerCbs.add(cb);
      return () => pointerCbs.delete(cb);
    },

    registerTool: (tool) => {
      tools.set(tool.id, tool);
      return () => {
        tools.delete(tool.id);
      };
    },

    registerHandler: (handler) => {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
        if (owner === handler) owner = null;
      };
    },

    setCursor: (token, cursor, priority = 0) => {
      if (cursor === null) claims.delete(token);
      else claims.set(token, { cursor, priority });
      syncCursor();
    },

    dispatch: (sample) => {
      // Passive observers first (cursor chrome like a tool badge) — they never
      // capture, so they see every sample regardless of gesture routing.
      pointerCbs.forEach((cb) => cb(sample));
      if (sample.phase === 'down') {
        owner = null;
        for (const h of eligible()) {
          if (h.onDown(sample)) {
            owner = h;
            break;
          }
        }
      } else if (sample.phase === 'move') {
        if (owner) owner.onMove?.(sample);
        else for (const h of eligible()) h.onHover?.(sample);
      } else {
        owner?.onUp?.(sample);
        owner = null;
      }
    },
  };
}
