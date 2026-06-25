import type { InteractionCapability, InteractionHandler } from '@embedpdf-x/plugin-interaction';
import type { Subtype } from '@embedpdf-x/annotation-core';
import type { AnnotationHostCapability } from './types';

/**
 * Ambient editing: live under the `annotation-edit` tag, which BOTH the pointer
 * and pan tools enable — so you select/move/resize in any navigation mode (Adobe
 * behaviour). It captures only over an annotation/handle; over empty it
 * deselects and declines (so text-selection / pan still work). Hover drives the
 * cursor (move / pointer / resize) via a priority cursor claim.
 */
export function createEditHandler(
  anno: AnnotationHostCapability,
  interaction: InteractionCapability,
): InteractionHandler {
  return {
    id: 'annotation-edit',
    priority: 100,
    enabledFor: (t) => t.enables.has('annotation-edit'),
    onDown: (s) => {
      if (!s.page) return false;
      if (anno.hitKind(s.page.pon, s.page.point) === 'empty') {
        anno.deselect(); // click on empty → drop the selection, let pan/text act
        return false;
      }
      anno.editPointer('down', s.page.pon, s.page.point, s.modifiers.shift);
      return true;
    },
    onMove: (s) => {
      if (s.page) anno.editPointer('move', s.page.pon, s.page.point, s.modifiers.shift);
    },
    onUp: (s) => {
      if (s.page) anno.editPointer('up', s.page.pon, s.page.point, false);
    },
    onHover: (s) => {
      // priority 20 → beats text-select's 'text' (10) over an annotation; null clears.
      interaction.setCursor(
        'annotation',
        s.page ? anno.cursorAt(s.page.pon, s.page.point) : null,
        20,
      );
    },
  };
}

/** Drawing: live under `annotation-draw` (the square / circle / line tools). */
export function createDrawHandler(
  anno: AnnotationHostCapability,
  interaction: InteractionCapability,
): InteractionHandler {
  const subtype = () => interaction.activeTool().id as Subtype;
  return {
    id: 'annotation-draw',
    priority: 90,
    enabledFor: (t) => t.enables.has('annotation-draw'),
    onDown: (s) => {
      if (!s.page) return false;
      anno.createPointer(subtype(), 'down', s.page.pon, s.page.point);
      return true;
    },
    onMove: (s) => {
      if (s.page) anno.createPointer(subtype(), 'move', s.page.pon, s.page.point);
    },
    onUp: (s) => {
      if (s.page) anno.createPointer(subtype(), 'up', s.page.pon, s.page.point);
    },
  };
}
