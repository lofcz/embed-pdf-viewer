import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@embedpdf-x/kernel';
import { createInteractionCapability } from './capability';
import { initialInteractionState, interactionReducer } from './reducer';
import { builtinTools } from './interaction.plugin';
import type {
  InteractionAction,
  InteractionHandler,
  InteractionState,
  PointerSample,
} from './types';

function harness(defaultTool = 'pointer') {
  let state = initialInteractionState({ defaultTool });
  const ctx = {
    getState: () => state,
    dispatch: (a: InteractionAction) => {
      state = interactionReducer(state, a);
    },
  } as unknown as PluginContext<InteractionState, InteractionAction>;
  const cap = createInteractionCapability(ctx, builtinTools());
  return { cap, state: () => state };
}

const sample = (phase: 'down' | 'move' | 'up'): PointerSample => ({
  phase,
  pon: 1,
  point: { x: 0, y: 0 },
  modifiers: { shift: false, alt: false, ctrl: false, meta: false },
});

const handler = (
  id: string,
  priority: number,
  tag: string,
  log: string[],
  capture = true,
): InteractionHandler => ({
  id,
  priority,
  enabledFor: (t) => t.enables.has(tag),
  onDown: () => {
    log.push(`${id}:down`);
    return capture;
  },
  onMove: () => log.push(`${id}:move`),
  onUp: () => log.push(`${id}:up`),
  onHover: () => log.push(`${id}:hover`),
});

describe('interaction hub', () => {
  it('defaults to the pointer tool and switches tools', () => {
    const { cap } = harness();
    expect(cap.activeToolId()).toBe('pointer');
    cap.activateTool('pan');
    expect(cap.activeToolId()).toBe('pan');
    expect(cap.cursor()).toBe('grab');
  });

  it('routes a gesture to the highest-priority eligible handler', () => {
    const { cap } = harness();
    const log: string[] = [];
    cap.registerHandler(handler('low', 10, 'text-select', log));
    cap.registerHandler(handler('high', 100, 'text-select', log));
    cap.dispatch(sample('down'));
    cap.dispatch(sample('move'));
    cap.dispatch(sample('up'));
    expect(log).toEqual(['high:down', 'high:move', 'high:up']); // 'low' never sees the gesture
  });

  it('gates handlers by the active tool (pan disables text-select)', () => {
    const { cap } = harness();
    const log: string[] = [];
    cap.registerHandler(handler('text', 60, 'text-select', log));
    cap.activateTool('pan'); // pan does NOT enable 'text-select'
    cap.dispatch(sample('down'));
    expect(log).toEqual([]); // handler is not eligible → nothing fires
  });

  it('a non-capturing down falls through; move with no owner is hover', () => {
    const { cap } = harness();
    const log: string[] = [];
    cap.registerHandler(handler('pass', 50, 'text-select', log, /* capture */ false));
    cap.dispatch(sample('down'));
    cap.dispatch(sample('move'));
    expect(log).toEqual(['pass:down', 'pass:hover']);
  });

  it('cursor claims override the tool cursor by priority', () => {
    const { cap } = harness();
    cap.setCursor('sel', 'text', 10);
    expect(cap.cursor()).toBe('text');
    cap.setCursor('sel', null);
    expect(cap.cursor()).toBe('default'); // back to the pointer tool's base cursor
  });
});
