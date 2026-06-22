import { definePlugin } from '@embedpdf-x/kernel';
import { InteractionToken } from '@embedpdf-x/plugin-interaction';
import { SelectionToken } from '@embedpdf-x/plugin-selection';
import { createAnnotationCapability } from './capability';
import { createDrawHandler, createEditHandler } from './handler';
import { wireMarkup } from './markup';
import { annotationReducer, initialAnnotationState } from './reducer';
import { AnnotationToken } from './types';
import type { AnnotationAction, AnnotationCapability, AnnotationState } from './types';

/**
 * The annotation plugin. Document-scoped; requires the interaction hub and
 * OPTIONALLY uses the selection plugin. Shapes/ink work with no selection; text
 * markup lights up only when a selection plugin is present.
 */
export const annotationPlugin = () =>
  definePlugin<AnnotationState, AnnotationAction, AnnotationCapability>({
    id: 'annotation',
    token: AnnotationToken,
    scope: 'document',
    requires: [InteractionToken],
    optional: [SelectionToken],
    initialState: initialAnnotationState,
    reduce: annotationReducer,
    capability: createAnnotationCapability,
    init: (ctx) => {
      const interaction = ctx.get(InteractionToken);
      const annotation = ctx.get(AnnotationToken);
      // Pointer-drawn kinds: square/circle/line (drag) and ink (freehand). They all
      // share the draw handler, which dispatches createPointer(activeTool.id, …).
      for (const id of ['square', 'circle', 'line', 'ink']) {
        interaction.registerTool({
          id,
          cursor: 'crosshair',
          enables: new Set(['annotation-draw', 'annotation-edit']),
        });
      }
      annotation.setDefaults('ink', { style: { strokeColor: '#1d4ed8', strokeWidth: 3 } });
      interaction.registerHandler(createEditHandler(annotation, interaction));
      interaction.registerHandler(createDrawHandler(annotation, interaction));

      // Markup is opt-in: only when a selection plugin is installed.
      const selection = ctx.tryGet(SelectionToken);
      if (selection) wireMarkup(annotation, selection, interaction);
    },
  });
