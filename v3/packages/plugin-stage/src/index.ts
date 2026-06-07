/**
 * @embedpdf-x/plugin-stage — the coordinate core, as a kernel plugin.
 *
 * In v2 these were five fighting plugins (viewport, scroll, zoom, pan, spread).
 * Here they are one Camera + Scene + flat settings. See the standard plugin layout:
 *   types.ts · settings.ts · reducer.ts · capability.ts · stage.plugin.ts
 */
export { stagePlugin } from './stage.plugin';
export { StageToken } from './types';
export { DEFAULT_SETTINGS } from './settings';
export type {
  LayoutKind,
  HomeKind,
  ScrollBehaviorKind,
  StageSettings,
  StageState,
  StageAction,
  StageViewState,
  StageCapability,
  StageConfig,
  Scheduler,
  VisiblePage,
} from './types';
// Re-export the view-vocabulary types the shell needs (spread modes, zoom modes, overscroll).
export type { SpreadMode, ZoomModeValue, Overscroll, ZoomSpec } from '@embedpdf-x/stage-core';
