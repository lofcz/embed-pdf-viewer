import type { InteractionCapability, InteractionHandler } from '@embedpdf-x/plugin-interaction';
import type { SelectionCapability } from './types';

/**
 * The text-selection pointer handler. It is live only under tools that enable the
 * `'text-select'` tag (the built-in `pointer` tool does; `pan` does not — so
 * switching to pan disables text selection with zero special-casing here).
 *
 * On down it captures the gesture; move extends; a plain click (down with no
 * drag) collapses to a caret and effectively clears via the begin/extend at one
 * glyph. Hover paints the I-beam over the page.
 */
export function createTextSelectHandler(
  selection: SelectionCapability,
  interaction: InteractionCapability,
): InteractionHandler {
  return {
    id: 'text-select',
    priority: 60,
    enabledFor: (tool) => tool.enables.has('text-select'),
    onDown: (s) => {
      if (!s.page) return false; // over a gap — let a lower handler (e.g. scroll) try
      selection.clear();
      selection.beginAt(s.page.pon, s.page.point);
      return true; // capture the drag
    },
    onMove: (s) => {
      if (s.page) selection.extendTo(s.page.pon, s.page.point);
    },
    onUp: () => selection.end(),
    onHover: (s) => {
      if (!s.page) return;
      // Warm geometry on first hover, and show the text cursor over the page.
      selection.ensurePage(s.page.pon);
      interaction.setCursor('selection-text', 'text', 10);
    },
  };
}
