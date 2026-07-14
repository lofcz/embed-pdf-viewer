import { createCapabilityToken } from '@embedpdf-x/kernel';
import type {
  FormDataExport,
  FormDataFormat,
  FormFieldDTO,
  FormFieldFamily,
  FormFieldPatch,
  FormFieldRef,
  FormFieldValue,
  FormImportResult,
  FormRepairOptions,
  FormRepairResult,
  FormSetValueResult,
  FormSnapshot,
  WidgetAppearance,
} from '@embedpdf/engine-core/runtime';

import type { FillItem } from './core/fill-items';
import type { Box, FieldKey, Model } from './core/model';

export interface FormState {
  model: Model;
}

/** Input for {@link FormCapability.placeField}. */
export interface PlaceFieldInput {
  family: Exclude<FormFieldFamily, 'pushbutton' | 'signature' | 'unknown'>;
  pageObjectNumber: number;
  /** Content-space LOGICAL field box (no visual padding semantics). */
  box: Box;
  /** Widget styling in the engine vocabulary (`WidgetAppearance`). Convert a
   *  tool's flat CSS defaults with `widgetAppearanceFromProps` from
   *  `@embedpdf-x/plugin-annotation`. Omitted → the engine's bare defaults. */
  appearance?: WidgetAppearance;
}

/** What {@link FormCapability.placeField} created. */
export interface PlacedField {
  field: FormFieldDTO;
  /** The widget placed on the requested page (join key to the annotation
   *  plane for auto-selection), or null when the engine reported none. */
  widget: FormFieldDTO['widgets'][number] | null;
}

export type FormAction = { type: 'SET_MODEL'; model: Model };

/**
 * The form plugin's public capability: the FIELD plane. Widgets stay
 * annotations (geometry/appearance live there); this surface owns values,
 * interchange, and the fill-mode projection.
 */
export interface FormCapability {
  /** The current reconciled form state (null until the first load lands). */
  snapshot(): FormSnapshot | null;
  /** Re-read the form from the engine (imports/repair/remote bursts). */
  refresh(): Promise<void>;

  /** Fill controls for one page — content-space, framework-agnostic. */
  fillItems(pageObjectNumber: number): FillItem[];
  /**
   * The fill control for ONE widget, by annotation object number — the join
   * the annotation-plane render layer uses (its RenderItem carries the live
   * box, so this item's `box` is advisory). Reference-stable per model change.
   * Null until the snapshot lands, or for families with no fill control.
   */
  fillItem(annotObjectNumber: number): FillItem | null;
  /** Make sure a page's widget geometry is loaded (idempotent, lazy). */
  ensureGeom(pageObjectNumber: number): void;

  field(key: FieldKey): FormFieldDTO | null;
  fieldForWidget(annotObjectNumber: number): FormFieldDTO | null;

  /** Commit a text value (call on blur/Enter — keystrokes stay local). */
  setText(key: FieldKey, value: string): Promise<void>;
  /** Toggle a checkbox/radio widget by its on-state; null clears the group. */
  toggle(key: FieldKey, onState: string | null): Promise<void>;
  /** Select choice options by export value. */
  choose(key: FieldKey, values: string[]): Promise<void>;
  /** Restore a field to its /DV default. */
  reset(key: FieldKey): Promise<void>;
  /** Raw engine passthrough for anything the sugar above doesn't cover. */
  setValue(ref: FormFieldRef, value: FormFieldValue): Promise<FormSetValueResult>;

  exportData(format?: FormDataFormat): Promise<FormDataExport>;
  importData(data: Uint8Array | ArrayBuffer, format?: FormDataFormat): Promise<FormImportResult>;
  repair(options?: FormRepairOptions): Promise<FormRepairResult>;

  // ── design mode (doc.forms.modify) ─────────────────────────────────────
  /**
   * Create a field of `family` with one styled widget at a content-space box
   * — the palette tools' commit, and the programmatic authoring entry (works
   * with NO annotation plugin: a pure `doc.forms` call). The box is clamped
   * to the page; sizing policy (click default vs drag rect) is the caller's.
   * The field gets a deterministic auto-name (`text_1`, …; rename in the
   * field panel). Resolves AFTER the annotation plane (when present) has
   * re-read the page, so the returned widget is immediately selectable.
   */
  placeField(input: PlaceFieldInput): Promise<PlacedField>;
  /** The page's content box (`{0,0,w,h}`) — page-bound placement math. */
  pageBox(pageObjectNumber: number): Box | null;
  /** Field-plane properties: name, required, options, default value. */
  updateField(key: FieldKey, patch: FormFieldPatch): Promise<void>;
  /** Delete the field and every widget of it (cascades on the page). */
  deleteField(key: FieldKey): Promise<void>;
  /** Unlink one widget: it stays as an inert annotation, the field survives. */
  detachWidget(key: FieldKey, annotObjectNumber: number): Promise<void>;

  /** UI mirror of the engine gates (`doc.forms.fill` / `doc.forms.modify`). */
  canFill(): boolean;
  canModify(): boolean;
}

export const FormToken = createCapabilityToken<FormCapability>('form');

export type { FillItem } from './core/fill-items';
export type { Box, FieldKey } from './core/model';
