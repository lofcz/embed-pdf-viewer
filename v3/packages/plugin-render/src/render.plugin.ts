import { definePlugin } from '@embedpdf-x/kernel';
import { createRenderCapability } from './capability';
import { RenderToken } from './types';

/** Document-scoped, stateless: just exposes the engine handle as a render capability. */
export const renderPlugin = () =>
  definePlugin({
    id: 'render',
    scope: 'document',
    token: RenderToken,
    capability: createRenderCapability,
  });
