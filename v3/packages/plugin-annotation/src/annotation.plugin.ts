import { definePlugin } from '@embedpdf-x/kernel';
import { InteractionToken } from '@embedpdf-x/plugin-interaction';
import { SelectionToken } from '@embedpdf-x/plugin-selection';
import { createAnnotationCapability } from './capability';
import { registerAnnotationEffects } from './effects';
import { createDrawHandler, createEditHandler, createMarqueeHandler } from './handler';
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
      // Pointer-drawn kinds: square/circle/line (drag), ink (freehand), and
      // free-text (drag a box, or click for a default one → opens straight into
      // edit). All share the draw handler → createPointer(activeTool.id, …).
      for (const id of ['square', 'circle', 'line', 'ink', 'free-text']) {
        interaction.registerTool({
          id,
          cursor: 'crosshair',
          enables: new Set(['annotation-draw', 'annotation-edit']),
        });
      }
      annotation.setDefaults('ink', { style: { color: '#1d4ed8', strokeWidth: 3 } });
      interaction.registerHandler(createEditHandler(annotation, interaction));
      interaction.registerHandler(createMarqueeHandler(annotation));
      interaction.registerHandler(createDrawHandler(annotation, interaction));

      // Markup is opt-in: only when a selection plugin is installed.
      const selection = ctx.tryGet(SelectionToken);
      if (selection) wireMarkup(annotation, selection, interaction);
    },
  });
