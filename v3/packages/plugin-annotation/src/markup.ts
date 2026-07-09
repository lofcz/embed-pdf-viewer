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
import type { AnnotationHostCapability } from './types';

/** The markup tool ids (their annotation subtypes), used only to route a commit. */
const MARKUP_SUBTYPES = new Set(['highlight', 'underline', 'strikeout', 'squiggly']);
const INSERT_TEXT_TOOL = 'insert-text';

/**
 * Wire the selection → annotation BRIDGE. The markup / caret TOOLS and their
 * defaults are registered by the plugin `init` from the tool registry; this
 * function only consumes the selection plugin's typed signals — so call it from
 * `init` only when a selection plugin is present. Selection is the producer,
 * annotation the consumer; selection never knows annotation exists.
 */
export function wireMarkup(
  annotation: AnnotationHostCapability,
  selection: SelectionCapability,
  interaction: InteractionCapability,
): void {
  // Keep the live preview + the selection's own visual in sync with (active tool,
  // selection). While a markup tool is active the blue highlight is suppressed and
  // the in-progress selection renders as a markup ghost instead.
  const sync = () => {
    const markup = MARKUP_SUBTYPES.has(interaction.activeToolId());
    selection.setHighlightVisible(!markup);
    if (markup && selection.hasSelection()) {
      const rectsByPage: Record<number, ReturnType<typeof selection.rectsForPage>> = {};
      for (const page of selection.snapshot().pages) rectsByPage[page.pon] = page.rects;
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
    const snapshot = selection.snapshot();
    if (tool === INSERT_TEXT_TOOL) {
      if (snapshot.end) annotation.createCaret(snapshot.end.pon, snapshot.end.rect);
      selection.clear();
      return;
    }
    if (!MARKUP_SUBTYPES.has(tool)) return; // pointer tool → leave the selection (copy)
    for (const page of snapshot.pages) annotation.createMarkup(tool, page.pon, page.rects);
    selection.clear(); // fires onChange → preview clears; blue stays suppressed (markup tool still active)
  });
}
