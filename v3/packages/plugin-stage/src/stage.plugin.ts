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
    scope: 'document', // one Stage (camera/layout/spread) per open document
    initialState: () => initialStageState(config),
    reduce: stageReducer,
    capability: createStageCapability,
    effects: (ctx) => {
      // Initial placement is a Stage concern, and it has exactly ONE owner. Once the
      // viewport has a real size, resolve the registered initial-view providers
      // (persist, deep-link, …) by priority — or fall back to home(). No reliance on
      // effect-ordering: every other plugin only *offers* a candidate.
      const stage = ctx.get(StageToken);
      let placed = false;
      ctx.watch(
        () => stage.viewport().width,
        (w) => {
          if (!placed && w > 0 && stage.pageCount() > 0) {
            placed = true;
            stage.placeInitial();
          }
        },
      );
    },
  });
