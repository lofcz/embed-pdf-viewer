/**
 * The fill-mode projection: what a framework paints for one page. Pure data
 * in CONTENT space (top-left origin, y-down PDF points) — the same space
 * annotation RenderItems use, so layers position with the page transform
 * and never re-derive scale.
 *
 * Geometry comes from the WIDGET plane: the shell reads each page's
 * annotations once (widgets are annotations; their DTOs carry /Rect) and
 * feeds content-space boxes into the model via `pageGeom`. The field plane
 * (this snapshot) contributes identity, value, and behavior.
 */
import type { FormFieldOption, FormSnapshot } from '@embedpdf/engine-core/runtime';

import { fieldKeyOf, type Box, type FieldKey, type Model } from './model';

export type { Box } from './model';

interface FillItemBase {
  key: FieldKey;
  /** Widget identity — joins to the annotation plane. */
  annotObjectNumber: number;
  box: Box;
  /** Read-only field or write in flight: render, don't accept input. */
  disabled: boolean;
  /** Accessible name: /TU when present, else the fully qualified name. */
  label: string;
}

export type FillItem = FillItemBase &
  (
    | {
        control: 'text';
        value: string;
        multiline: boolean;
        password: boolean;
        maxLength: number | null;
        comb: boolean;
      }
    | { control: 'toggle'; kind: 'checkbox' | 'radio'; checked: boolean; onState: string }
    | {
        control: 'choice';
        kind: 'combo' | 'list';
        edit: boolean;
        multi: boolean;
        options: FormFieldOption[];
        selected: string[];
      }
    | { control: 'button' }
  );

/**
 * Project one page's widgets into fill controls. Widgets whose geometry has
 * not arrived yet (or that are direct objects with no join key) are skipped —
 * the shell re-runs the projection when `pageGeom` lands.
 */
export function fillItems(model: Model, pageObjectNumber: number): FillItem[] {
  const snapshot: FormSnapshot | null = model.snapshot;
  const geom = model.geom[pageObjectNumber];
  if (!snapshot || !geom) return [];
  const items: FillItem[] = [];

  for (const field of snapshot.fields) {
    const key = fieldKeyOf(field);
    const disabled = field.flags.readOnly || model.writing[key] === true;
    const label = field.alternateName ?? field.name;

    for (const widget of field.widgets) {
      if (widget.pageObjectNumber !== pageObjectNumber) continue;
      const box = geom[widget.annotObjectNumber];
      if (!box) continue;
      const base: FillItemBase = {
        key,
        annotObjectNumber: widget.annotObjectNumber,
        box,
        disabled,
        label,
      };
      switch (field.family) {
        case 'text':
          items.push({
            ...base,
            control: 'text',
            value: field.value,
            multiline: field.multiline,
            password: field.password,
            maxLength: field.maxLength,
            comb: field.comb,
          });
          break;
        case 'checkbox': {
          const toggle = field.widgets.find(
            (w) => w.annotObjectNumber === widget.annotObjectNumber,
          );
          items.push({
            ...base,
            control: 'toggle',
            kind: 'checkbox',
            checked: field.checked,
            onState: toggle && 'onState' in toggle ? toggle.onState : 'Yes',
          });
          break;
        }
        case 'radio': {
          const toggle = field.widgets.find(
            (w) => w.annotObjectNumber === widget.annotObjectNumber,
          );
          items.push({
            ...base,
            control: 'toggle',
            kind: 'radio',
            checked: toggle && 'checked' in toggle ? toggle.checked : false,
            onState: toggle && 'onState' in toggle ? toggle.onState : '',
          });
          break;
        }
        case 'combobox':
          items.push({
            ...base,
            control: 'choice',
            kind: 'combo',
            edit: field.edit,
            multi: false,
            options: field.options,
            selected: field.value === '' ? [] : [field.value],
          });
          break;
        case 'listbox':
          items.push({
            ...base,
            control: 'choice',
            kind: 'list',
            edit: false,
            multi: field.multiSelect,
            options: field.options,
            selected: field.selectedValues,
          });
          break;
        case 'pushbutton':
          items.push({ ...base, control: 'button' });
          break;
        default:
          break; // signature/unknown: rendered by the annotation plane only
      }
    }
  }
  return items;
}
