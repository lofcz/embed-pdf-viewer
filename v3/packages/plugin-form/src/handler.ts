import type { InteractionCapability, InteractionHandler } from '@embedpdf-x/plugin-interaction';

import type { Box } from './core/model';
import type { FormCapability } from './types';

/** Palette tool → field family. */
export const FAMILY_BY_TOOL = {
  'form-text': 'text',
  'form-checkbox': 'checkbox',
  'form-radio': 'radio',
  'form-combobox': 'combobox',
  'form-listbox': 'listbox',
} as const;

export type PlaceToolId = keyof typeof FAMILY_BY_TOOL;

/**
 * Draw-to-place: drag a box (or just click — `placeField` substitutes the
 * family's default size) and the commit creates the field + widget through
 * `doc.forms`. The tool stays active so several fields can be placed in a
 * row, v2-style; the widgets are immediately selectable because the palette
 * tools also enable `annotation-edit`.
 */
export function createPlaceHandler(
  form: FormCapability,
  interaction: InteractionCapability,
): InteractionHandler {
  let origin: {
    pon: number;
    start: { x: number; y: number };
    last: { x: number; y: number };
  } | null = null;
  return {
    id: 'form-place',
    // Above the annotation edit handler (100): while a palette tool is
    // active, a drag on empty page means "place a field", not "marquee".
    priority: 105,
    enabledFor: (t) => t.enables.has('form-place'),
    onDown: (s) => {
      if (!s.page) return false;
      origin = { pon: s.page.pon, start: s.page.point, last: s.page.point };
      return true;
    },
    onMove: (s) => {
      if (origin && s.page && s.page.pon === origin.pon) origin.last = s.page.point;
    },
    onUp: () => {
      if (!origin) return;
      const { pon, start, last } = origin;
      origin = null;
      const family = FAMILY_BY_TOOL[interaction.activeToolId() as PlaceToolId];
      if (!family) return;
      const box: Box = {
        x: Math.min(start.x, last.x),
        y: Math.min(start.y, last.y),
        width: Math.abs(last.x - start.x),
        height: Math.abs(last.y - start.y),
      };
      void form.placeField(family, pon, box);
    },
  };
}
