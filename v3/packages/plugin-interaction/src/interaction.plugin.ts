import { definePlugin } from '@embedpdf-x/kernel';
import { createInteractionCapability } from './capability';
import { initialInteractionState, interactionReducer } from './reducer';
import { InteractionToken } from './types';
import type {
  InteractionAction,
  InteractionCapability,
  InteractionConfig,
  InteractionState,
  Tool,
} from './types';

/**
 * The two built-in tools. Features ADD tools via `registerTool` (a draw tool, a
 * redact tool…). `enables` is the composition seam:
 *   pointer → text selection + annotation editing (reading-first default)
 *   pan     → scrolling (contributed by Stage) + annotation editing, NO text select
 */
export const builtinTools = (): Tool[] => [
  { id: 'pointer', cursor: 'default', enables: new Set(['text-select', 'annotation-edit']) },
  { id: 'pan', cursor: 'grab', enables: new Set(['scroll', 'annotation-edit']) },
];

/**
 * The interaction hub plugin — document-scoped, depends on nothing. Every feature
 * plugin (selection, annotation, forms, redaction) `requires` this token; Stage
 * `optional`-ly contributes a scroll handler. Works with `<Stage>` or a standalone
 * `<PageView>` — it only routes page-space pointer samples.
 */
export const interactionPlugin = (config: InteractionConfig = {}) =>
  definePlugin<InteractionState, InteractionAction, InteractionCapability>({
    id: 'interaction',
    token: InteractionToken,
    scope: 'document',
    initialState: () => initialInteractionState(config),
    reduce: interactionReducer,
    capability: (ctx) => createInteractionCapability(ctx, builtinTools()),
  });
