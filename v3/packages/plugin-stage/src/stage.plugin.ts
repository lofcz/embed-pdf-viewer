import { definePlugin } from '@embedpdf-x/kernel';
import type { CapabilityToken } from '@embedpdf-x/kernel';
import { createStageCapability } from './capability';
import { initialStageState, stageReducer } from './reducer';
import { StageToken } from './types';
import type { StageAction, StageCapability, StageConfig, StageState } from './types';

/**
 * Options for registering a stage instance. The Stage is a LENS, not a singleton:
 * a document may be viewed through several stages at once (the main view, a wrapped
 * thumbnail sidebar, …), each with independent camera/settings. Register additional
 * lenses by giving them their own `id` + `token`:
 *
 *   const ThumbsToken = createCapabilityToken<StageCapability>('stage-thumbs');
 *   plugins = [
 *     stagePlugin(),                                                   // main lens
 *     stagePlugin({ id: 'stage-thumbs', token: ThumbsToken,
 *                   layout: 'grid', columns: 'auto', zoom: { level: 0.2 } }),
 *   ];
 *
 * Everything multiplexes automatically: state slices, capabilities, and teardown
 * are already keyed by plugin-id × document in the kernel.
 */
export interface StagePluginOptions extends StageConfig {
  id?: string;
  token?: CapabilityToken<StageCapability>;
}

/**
 * Wires the parts into a kernel plugin. This file is the "manifest": it says what
 * the plugin IS (id, token, state, reducer, capability) — the how lives in the
 * sibling files.
 */
export const stagePlugin = (options: StagePluginOptions = {}) => {
  const { id = 'stage', token = StageToken, ...config } = options;
  return definePlugin<StageState, StageAction, StageCapability>({
    id,
    token,
    scope: 'document', // one instance of THIS lens per open document
    initialState: () => initialStageState(config),
    reduce: stageReducer,
    capability: (ctx) => createStageCapability(ctx, config),
    // No effects: initial placement is LEVEL-triggered inside the capability's
    // setViewport (place when the stage first learns a real size), so it cannot
    // race effect registration. Other plugins only *offer* initial views via
    // provideInitialView; placeInitial resolves them by priority.
  });
};
