import { definePlugin } from '@embedpdf/kernel';
import { createStageCapability } from './capability';
import { initialStageState, stageReducer } from './reducer';
import { StageToken } from './types';
import type { StageAction, StageCapability, StageConfig, StageState } from './types';

/**
 * Wires the parts into a kernel plugin. This file is the "manifest": it says what
 * the plugin IS (id, token, state, reducer, capability, effects) — the how lives in
 * the sibling files.
 */
export const stagePlugin = (config: StageConfig = {}) =>
  definePlugin<StageState, StageAction, StageCapability>({
    id: 'stage',
    token: StageToken,
    initialState: () => initialStageState(config),
    reduce: stageReducer,
    capability: createStageCapability,
    effects: (ctx) => {
      // Initial placement is a Stage concern, not the shell's: once the viewport has
      // a real size, home the document. (A persist plugin can override afterwards.)
      const stage = ctx.get(StageToken);
      let homed = false;
      ctx.watch(
        () => stage.viewport().width,
        (w) => {
          if (!homed && w > 0 && stage.pageCount() > 0) {
            homed = true;
            stage.home();
          }
        },
      );
    },
  });
