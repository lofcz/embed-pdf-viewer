import type { InteractionCapability, InteractionHandler } from '@embedpdf-x/plugin-interaction';
import type { Subtype, Vec } from '@embedpdf-x/annotation-core';
import type { AnnotationHostCapability } from './types';

const MARQUEE_DRAG_THRESHOLD_PX = 4;
const isPolyTool = (subtype: Subtype): boolean => subtype === 'polygon' || subtype === 'polyline';
const isCalloutTool = (subtype: Subtype): boolean => subtype === 'free-text-callout';

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
      // While a free-text box is being edited it owns its own pointer events, so a
      // down that reaches the hub at all is a click OUTSIDE the editor — commit and
      // leave text edit. This makes exit hub-driven (deterministic) rather than
      // relying on a DOM blur, which races the focus-steal of the entering gesture.
      const wasEditing = anno.currentEditing() != null;
      if (wasEditing) anno.endTextEdit();
      if (anno.hitKind(s.page.pon, s.page.point) === 'empty') {
        // Plain empty click drops the selection. Shift-empty preserves it so the
        // lower-priority marquee handler can additive/toggle-select.
        if (!s.modifiers.shift) anno.deselect();
        // A click that dismissed an active edit is CONSUMED: its sole job was to
        // leave edit mode, so the draw tool doesn't also spawn a new annotation
        // (matches v2). Only when nothing was being edited do we decline, letting
        // pan / text-selection / draw act on the empty click.
        return wasEditing;
      }
      // Double-click over a free-text box → enter text edit (not a move).
      if ((s.clickCount ?? 1) >= 2) {
        anno.beginTextEditAt(s.page.pon, s.page.point);
        return true;
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

/**
 * Empty-page drag selection. Lower priority than annotation edit and text
 * selection, so it only owns drags that begin on empty, non-text page space.
 */
export function createMarqueeHandler(anno: AnnotationHostCapability): InteractionHandler {
  let anchor: {
    pon: number;
    point: Vec;
    vx: number;
    vy: number;
    shift: boolean;
  } | null = null;
  let last: { pon: number; point: Vec } | null = null;
  let dragging = false;

  return {
    id: 'annotation-marquee',
    priority: 50,
    enabledFor: (t) => t.enables.has('annotation-marquee'),
    onDown: (s) => {
      if (!s.page) return false;
      anchor = {
        pon: s.page.pon,
        point: s.page.point,
        vx: s.viewport.x,
        vy: s.viewport.y,
        shift: s.modifiers.shift,
      };
      last = { pon: s.page.pon, point: s.page.point };
      dragging = false;
      return true;
    },
    onMove: (s) => {
      if (!anchor || !s.page || s.page.pon !== anchor.pon) return;
      last = { pon: s.page.pon, point: s.page.point };
      if (!dragging) {
        if (
          Math.hypot(s.viewport.x - anchor.vx, s.viewport.y - anchor.vy) < MARQUEE_DRAG_THRESHOLD_PX
        ) {
          return;
        }
        dragging = true;
        anno.marqueePointer('down', anchor.pon, anchor.point, anchor.shift);
      }
      anno.marqueePointer('move', s.page.pon, s.page.point, anchor.shift);
    },
    onUp: () => {
      if (dragging && anchor && last) {
        anno.marqueePointer('up', anchor.pon, last.point, anchor.shift);
      }
      anchor = null;
      last = null;
      dragging = false;
    },
  };
}

/** Drawing: live under `annotation-draw` (the square / circle / line tools). */
export function createDrawHandler(
  anno: AnnotationHostCapability,
  interaction: InteractionCapability,
): InteractionHandler {
  const subtype = () => interaction.activeTool().id as Subtype;
  let drawingPoly = false;
  // A callout is mid-creation between its tip/knee/box clicks; while it is, hover
  // (no button) must still drive the leader/box preview, like a poly's vertices.
  let drawingCallout = false;
  interaction.onToolChange(() => {
    drawingPoly = false;
    drawingCallout = false;
  });
  return {
    id: 'annotation-draw',
    priority: 90,
    enabledFor: (t) => t.enables.has('annotation-draw'),
    onDown: (s) => {
      if (!s.page) return false;
      const st = subtype();
      if (isPolyTool(st)) {
        const finish = (s.clickCount ?? 1) >= 2;
        anno.createPointer(st, 'down', s.page.pon, s.page.point, finish);
        drawingPoly = !finish;
        return true;
      }
      drawingPoly = false;
      // Each callout click advances the core's tip → knee → box state machine; the
      // final box click/drag commits and clears the draft (so `drawingCallout`
      // resets on the next tool change or simply idles harmlessly).
      if (isCalloutTool(st)) drawingCallout = true;
      anno.createPointer(st, 'down', s.page.pon, s.page.point);
      return true;
    },
    onMove: (s) => {
      const st = subtype();
      // Drag-moves (button down): rect/line/ink/free-text size their box, and a
      // callout (a non-poly tool) sizes its text box during the box step. Poly
      // tools take vertices by click, so they ignore drag-moves.
      if (s.page && (!isPolyTool(st) || drawingPoly)) {
        anno.createPointer(st, 'move', s.page.pon, s.page.point);
      }
    },
    onUp: (s) => {
      const st = subtype();
      if (s.page && !isPolyTool(st)) anno.createPointer(st, 'up', s.page.pon, s.page.point);
    },
    onHover: (s) => {
      const st = subtype();
      // Hover preview for the multi-click tools: poly (while placing vertices) and
      // callout (while placing the tip/knee/box) follow the cursor between clicks.
      if (s.page && ((drawingPoly && isPolyTool(st)) || (drawingCallout && isCalloutTool(st)))) {
        anno.createPointer(st, 'move', s.page.pon, s.page.point);
      }
    },
  };
}
