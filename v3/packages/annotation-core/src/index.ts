/**
 * @embedpdf-x/annotation-core — the pure annotation brain.
 *
 * model · update(msg)→[model,effects] · view (pageItems + chrome). Per-kind
 * content-space geometry (rect/ellipse · line · poly · quads), stroke+fill
 * hit-testing, cursors, the select + create tools. No DOM, no engine, no
 * framework — the part that ports to Rust/Crux.
 */
export { update, initialModel, initialStyle, defaultsFor } from './update';
export {
  pageItems,
  chrome,
  selectedItems,
  textBoxes,
  selectionBoundsOnPage,
  selectionAnchor,
  creationDraftAnchor,
} from './view';
export type { TextBox } from './view';
export { hitTest, cursorAt, isSelectable, canMove, type Target } from './hit';
export { KINDS, capsFor, type KindCaps, type AnnotationKind } from './kinds';
export {
  geomScene,
  geomBounds,
  geomVisualBounds,
  geomHit,
  geomHandles,
  geomTranslate,
  geomDragHandle,
  geomPdfBounds,
  pdfToContentRect,
  contentToPdfRect,
  pdfToContentPoint,
  contentToPdfPoint,
  rectFromPoints,
  caretRectFromTextEnd,
  selectionBounds,
  shapeRectFor,
  unionRect,
  RECT_HANDLES,
  type RectHandle,
} from './geometry';
export { cloudyPath, cloudyBorderExtent } from './cloudy';
export { scene } from './scene';
export type {
  Annot,
  Border,
  ChromeNode,
  Cursor,
  CreationDraftAnchor,
  Draft,
  Effect,
  Geom,
  Handle,
  Id,
  Model,
  Msg,
  PointerInput,
  Quad,
  Rect,
  LineEnding,
  LineEndings,
  Paint,
  RenderItem,
  RenderNode,
  SceneNode,
  Style,
  Subtype,
  ToolDefaults,
  Vec,
} from './types';
