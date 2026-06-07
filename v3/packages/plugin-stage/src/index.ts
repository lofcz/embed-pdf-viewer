/**
 * @embedpdf-x/plugin-stage — the coordinate core, as a kernel plugin.
 *
 * In v2 these were five fighting plugins (viewport, scroll, zoom, pan, spread).
 * Here they are one Camera + Scene + framing. See the standard plugin layout:
 *   types.ts · framing.ts · reducer.ts · capability.ts · stage.plugin.ts
 */
export { stagePlugin } from './stage.plugin';
export { StageToken } from './types';
export type {
  LayoutKind,
  FramingKind,
  StageState,
  StageAction,
  StageViewState,
  StageCapability,
  StageConfig,
  VisiblePage,
} from './types';
