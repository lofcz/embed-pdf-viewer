import { definePlugin } from '@embedpdf/kernel';
import { StageToken } from '@embedpdf/stage';
import { registerPersistEffects } from './effects';
import type { PersistConfig } from './types';

/**
 * An effects-only plugin: no state, no capability. It REQUIRES the Stage (so the
 * kernel fails fast + orders init) and reacts to its view-state. The canonical use
 * of `requires` + `effects`.
 */
export const persistPlugin = (config: PersistConfig) =>
  definePlugin({
    id: 'persist',
    requires: [StageToken],
    effects: (ctx) => registerPersistEffects(ctx, config),
  });
