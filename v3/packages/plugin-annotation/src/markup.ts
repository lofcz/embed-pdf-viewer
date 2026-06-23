/**
 * Text-markup authoring: the bridge that turns a TEXT SELECTION into highlight /
 * underline / strikeout / squiggly annotations. Markup has no gesture of its own —
 * its tools enable the selection plugin's `text-select` gesture, and this module
 * consumes selection's typed signals (`onCommit` to create, `onChange` to preview).
 * Selection is the producer; annotation the consumer — selection never knows
 * annotation exists. Kept out of the plugin-definition file so that stays lean.
 */
import type { InteractionCapability } from '@embedpdf-x/plugin-interaction';
import type { SelectionCapability } from '@embedpdf-x/plugin-selection';
import type { AnnotationCapability } from './types';

/** Text-markup tools and their default colours (seeded as tool defaults). */
const MARKUP_DEFAULTS: Record<string, string> = {
  highlight: '#ffe16a',
  underline: '#3b82f6',
  strikeout: '#ef4444',
  squiggly: '#22c55e',
};
const MARKUP_SUBTYPES = new Set(Object.keys(MARKUP_DEFAULTS));

/**
 * Register the markup tools and wire selection → annotation. Call from the plugin's
 * `init` only when a selection plugin is present.
 */
export function wireMarkup(
  annotation: AnnotationCapability,
  selection: SelectionCapability,
  interaction: InteractionCapability,
): void {
  for (const id of MARKUP_SUBTYPES) {
    // text-select → selection runs the drag; annotation-edit → click existing markup to select it
    interaction.registerTool({
      id,
      cursor: 'text',
      enables: new Set(['text-select', 'annotation-edit']),
    });
    annotation.setDefaults(id, {
      style: { color: MARKUP_DEFAULTS[id] },
    });
  }

  // Keep the live preview + the selection's own visual in sync with (active tool,
  // selection). While a markup tool is active the blue highlight is suppressed and
  // the in-progress selection renders as a markup ghost instead.
  const sync = () => {
    const markup = MARKUP_SUBTYPES.has(interaction.activeToolId());
    selection.setHighlightVisible(!markup);
    if (markup && selection.hasSelection()) {
      const rectsByPage: Record<number, ReturnType<typeof selection.rectsForPage>> = {};
      for (const pon of selection.selectedPages()) rectsByPage[pon] = selection.rectsForPage(pon);
      annotation.previewMarkup(interaction.activeToolId(), rectsByPage);
    } else {
      annotation.clearMarkupPreview();
    }
  };
  selection.onChange(sync); // drag-extend → live preview
  interaction.onToolChange(sync); // entering/leaving a markup tool → restore blue / clear ghost

  // On gesture-end, if a markup tool is active, turn the selection into markup.
  selection.onCommit(() => {
    const tool = interaction.activeToolId();
    if (!MARKUP_SUBTYPES.has(tool)) return; // pointer tool → leave the selection (copy)
    for (const pon of selection.selectedPages())
      annotation.createMarkup(tool, pon, selection.rectsForPage(pon));
    selection.clear(); // fires onChange → preview clears; blue stays suppressed (markup tool still active)
  });
}
