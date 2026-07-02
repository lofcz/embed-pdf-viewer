import { definePlugin } from '@embedpdf-x/kernel';
import { InteractionToken } from '@embedpdf-x/plugin-interaction';
import { SelectionToken } from '@embedpdf-x/plugin-selection';
import { createAnnotationCapability } from './capability';
import { registerAnnotationEffects } from './effects';
import {
  createDrawHandler,
  createEditHandler,
  createMarqueeHandler,
  createStampHandler,
} from './handler';
import { wireMarkup } from './markup';
import { annotationReducer, initialAnnotationState } from './reducer';
import { AnnotationToken } from './types';
import type { AnnotationAction, AnnotationHostCapability, AnnotationState } from './types';

/**
 * The annotation plugin. Document-scoped; requires the interaction hub and
 * OPTIONALLY uses the selection plugin. Shapes/ink work with no selection; text
 * markup lights up only when a selection plugin is present.
 */
export const annotationPlugin = () =>
  definePlugin<AnnotationState, AnnotationAction, AnnotationHostCapability>({
    id: 'annotation',
    token: AnnotationToken,
    scope: 'document',
    requires: [InteractionToken],
    optional: [SelectionToken],
    initialState: initialAnnotationState,
    reduce: annotationReducer,
    capability: createAnnotationCapability,
    // Fold in remote collaborators' edits (own edits flow through the capability).
    effects: registerAnnotationEffects,
    init: (ctx) => {
      const interaction = ctx.get(InteractionToken);
      const annotation = ctx.get(AnnotationToken);
      // Pointer-drawn kinds: square/circle/line (drag), polygon/polyline
      // (click vertices, double-click to finish), ink (freehand), and free-text
      // (drag a box, or click for a default one → opens straight into edit).
      // All share the draw handler → createPointer(activeTool.id, …).
      for (const id of [
        'square',
        'circle',
        'line',
        'polygon',
        'polyline',
        'ink',
        'free-text',
        'free-text-callout',
      ]) {
        interaction.registerTool({
          id,
          cursor: 'crosshair',
          enables: new Set(['annotation-draw', 'annotation-edit']),
        });
      }
      annotation.setDefaults('ink', { color: '#1d4ed8', strokeWidth: 3 });
      // A callout's leader + box border need a visible stroke; its arrow defaults
      // to an open arrowhead at the called-out tip.
      annotation.setDefaults('free-text-callout', {
        strokeWidth: 1,
        lineEndings: { end: 'open-arrow' },
      });
      // Stamp: click-to-place (no drag) — armed via `annotation.armStamp(...)`,
      // which also activates this tool. Editing stays live so placed stamps
      // can be selected/moved without switching tools.
      interaction.registerTool({
        id: 'stamp',
        cursor: 'copy',
        enables: new Set(['annotation-stamp', 'annotation-edit']),
      });
      interaction.registerHandler(createStampHandler(annotation));
      interaction.registerHandler(createEditHandler(annotation, interaction));
      interaction.registerHandler(createMarqueeHandler(annotation));
      interaction.registerHandler(createDrawHandler(annotation, interaction));
      interaction.onToolChange(() => {
        annotation.cancel();
        // Leaving the stamp tool drops its armed payload — bytes are tool
        // state, not document state.
        if (interaction.activeToolId() !== 'stamp') annotation.disarmStamp();
      });

      // Markup is opt-in: only when a selection plugin is installed.
      const selection = ctx.tryGet(SelectionToken);
      if (selection) wireMarkup(annotation, selection, interaction);
    },
  });
