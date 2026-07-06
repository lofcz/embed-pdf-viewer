import { definePlugin } from '@embedpdf-x/kernel';
import { InteractionToken } from '@embedpdf-x/plugin-interaction';
import { AnnotationToken } from '@embedpdf-x/plugin-annotation';
// Behavior registration lives on the HOST capability (framework/plugin
// surface) — same runtime token, wider type.
import { AnnotationToken as AnnotationHostToken } from '@embedpdf-x/plugin-annotation/internal';

import { createFormCapability } from './capability';
import { createPlaceHandler, FAMILY_BY_TOOL } from './handler';
import { registerFormEffects } from './effects';
import { formReducer, initialFormState } from './reducer';
import { FormToken } from './types';
import type { FormAction, FormCapability, FormState } from './types';

/**
 * The form plugin: the FIELD plane. Document-scoped; requires the
 * interaction hub. Fill mode works with no annotation plugin at all —
 * geometry is read from the engine's widget DTOs. When the annotation
 * plugin IS present, a Behavior keeps widgets geometry-inert while the
 * fill tool is active (and vice versa: fill controls stand down when any
 * other tool is active — the single-active-tool hub IS the mode switch).
 */
export const formPlugin = () =>
  definePlugin<FormState, FormAction, FormCapability>({
    id: 'form',
    token: FormToken,
    scope: 'document',
    requires: [InteractionToken],
    optional: [AnnotationToken],
    initialState: initialFormState,
    reduce: formReducer,
    capability: createFormCapability,
    effects: registerFormEffects,
    init: (ctx) => {
      const interaction = ctx.get(InteractionToken);
      const form = ctx.get(FormToken);
      interaction.registerTool({
        id: 'form-fill',
        cursor: 'default',
        enables: new Set(['form-fill']),
      });
      // Field palette: draw-to-place. `annotation-edit` stays enabled so the
      // freshly placed widgets are immediately selectable/movable.
      for (const id of Object.keys(FAMILY_BY_TOOL)) {
        interaction.registerTool({
          id,
          cursor: 'crosshair',
          enables: new Set(['form-place', 'annotation-edit']),
        });
      }
      interaction.registerHandler(createPlaceHandler(form, interaction));

      const annotation = ctx.tryGet(AnnotationHostToken);
      if (annotation) {
        annotation.registerBehavior({
          id: 'form-widgets',
          matches: (a) => a.subtype.startsWith('widget'),
          engaged: () => interaction.activeTool()?.enables.has('form-fill') ?? false,
        });
      }
    },
  });
