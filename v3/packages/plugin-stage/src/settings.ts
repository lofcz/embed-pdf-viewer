import { ZoomMode } from '@embedpdf-x/stage-core';
import type { StageSettings } from './types';

/**
 * Out-of-the-box defaults — a sensible document-reading feel. They are JUST
 * defaults: every field is overridable in `stagePlugin(config)` and at runtime via
 * the setters / `update()`. The plugin ships NO named presets ("document",
 * "canvas", …) — a preset is simply an object the app keeps and passes to
 * `update()`, so that taxonomy stays a customer concern.
 */
export const DEFAULT_SETTINGS: StageSettings = {
  flow: 'continuous',
  layout: 'vertical',
  spread: 'none',
  sizing: 'intrinsic',
  columns: 'square',
  bounded: true,
  padding: 24,
  gap: 16,
  pageMargin: { top: 0, right: 0, bottom: 0, left: 0 },
  direction: 'ltr',
  fitAlign: { x: 'center', y: 'center' },
  overflowAlign: { x: 'start', y: 'start' },
  zoom: { mode: ZoomMode.Automatic },
  scrollBehavior: 'smooth',
};
