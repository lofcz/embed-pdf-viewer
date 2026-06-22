import { definePlugin } from '@embedpdf-x/kernel';
import { InteractionToken } from '@embedpdf-x/plugin-interaction';
import { createAnnotationCapability } from './capability';
import { createDrawHandler, createEditHandler } from './handler';
import { annotationReducer, initialAnnotationState } from './reducer';
import { AnnotationToken } from './types';
import type { AnnotationAction, AnnotationCapability, AnnotationState } from './types';

/**
 * The annotation plugin. Document-scoped, requires the interaction hub. In `init`
 * it registers the draw tools (`square`/`circle`) and two handlers: ambient
 * editing (enabled in pointer + pan) and drawing (enabled by the draw tools).
 */
export const annotationPlugin = () =>
  definePlugin<AnnotationState, AnnotationAction, AnnotationCapability>({
    id: 'annotation',
    token: AnnotationToken,
    scope: 'document',
    requires: [InteractionToken],
    initialState: initialAnnotationState,
    reduce: annotationReducer,
    capability: createAnnotationCapability,
    init: (ctx) => {
      const interaction = ctx.get(InteractionToken);
      const annotation = ctx.get(AnnotationToken);
      interaction.registerTool({
        id: 'square',
        cursor: 'crosshair',
        enables: new Set(['annotation-draw', 'annotation-edit']),
      });
      interaction.registerTool({
        id: 'circle',
        cursor: 'crosshair',
        enables: new Set(['annotation-draw', 'annotation-edit']),
      });
      interaction.registerTool({
        id: 'line',
        cursor: 'crosshair',
        enables: new Set(['annotation-draw', 'annotation-edit']),
      });
      interaction.registerHandler(createEditHandler(annotation, interaction));
      interaction.registerHandler(createDrawHandler(annotation, interaction));
    },
  });
