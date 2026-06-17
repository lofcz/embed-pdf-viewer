import type { InteractionHandler } from '@embedpdf-x/plugin-interaction';
import type { StageCapability } from './types';

/**
 * Pan-the-camera as an interaction handler. Live only under tools that enable the
 * `'scroll'` tag (the built-in `pan` tool), so dragging pans in pan mode and
 * selects text in pointer mode — no special-casing in the Stage. It uses the
 * sample's viewport delta, so it pans over the WHOLE viewport (pages and gaps).
 */
export function createScrollHandler(stage: StageCapability): InteractionHandler {
  let last = { x: 0, y: 0 };
  return {
    id: 'stage-scroll',
    priority: 10, // below page-aware handlers (selection/annotation) — they claim first
    enabledFor: (tool) => tool.enables.has('scroll'),
    onDown: (s) => {
      last = s.viewport;
      return true; // capture the drag
    },
    onMove: (s) => {
      stage.panBy(s.viewport.x - last.x, s.viewport.y - last.y);
      last = s.viewport;
    },
    onUp: () => {
      /* nothing to finalize */
    },
  };
}
