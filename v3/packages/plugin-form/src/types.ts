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
} from '@embedpdf/engine-core/runtime';

import type { FillItem } from './core/fill-items';
import type { Box, FieldKey, Model } from './core/model';

export interface FormState {
  model: Model;
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
   * Create a field of `family` with one widget at a content-space box on
   * the page — the palette tools' commit. The field gets an auto-generated
   * name (rename in the field panel) and a per-family default size when
   * the box is degenerate (a click, not a drag).
   */
  placeField(
    family: Exclude<FormFieldFamily, 'pushbutton' | 'signature' | 'unknown'>,
    pageObjectNumber: number,
    box: Box,
  ): Promise<void>;
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
