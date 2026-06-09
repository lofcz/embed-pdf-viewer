import { definePlugin } from '@embedpdf-x/kernel';
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
    capability: (ctx) => createStageCapability(ctx, config),
    // No effects: initial placement is LEVEL-triggered inside the capability's
    // setViewport (place when the stage first learns a real size), so it cannot
    // race effect registration. Other plugins only *offer* initial views via
    // provideInitialView; placeInitial resolves them by priority.
  });
