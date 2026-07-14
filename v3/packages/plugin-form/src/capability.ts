import type { PluginContext } from '@embedpdf-x/kernel';
import type {
  FormDataFormat,
  FormFieldDraft,
  FormFieldFamily,
  FormFieldPatch,
  FormFieldRef,
  FormFieldValue,
  PdfRect,
} from '@embedpdf/engine-core/runtime';
import { AnnotationToken as AnnotationHostToken } from '@embedpdf-x/plugin-annotation/internal';

import {
  fillItemForWidget as coreFillItemForWidget,
  fillItems as coreFillItems,
  type FillItem,
} from './core/fill-items';
import {
  fieldByKey,
  fieldForWidget as coreFieldForWidget,
  update,
  type Box,
  type FieldKey,
  type Model,
  type Msg,
} from './core/model';
import type { FormAction, FormCapability, FormState } from './types';

/** PDF user-space rect (y-up) → content-space box (y-down, crop-relative). */
const toBox = (rect: PdfRect, crop: PdfRect): Box => ({
  x: rect.left - crop.left,
  y: crop.top - rect.top,
  width: rect.right - rect.left,
  height: rect.top - rect.bottom,
});

/**
 * The form shell. Pure `update` runs here; the resulting model is dispatched
 * to the store; engine calls happen around it. Every read the frameworks do
 * goes through memoized projections keyed on `model.seq`.
 */
export function createFormCapability(ctx: PluginContext<FormState, FormAction>): FormCapability {
  const model = (): Model => ctx.getState().model;
  const apply = (msg: Msg): void => {
    ctx.dispatch({ type: 'SET_MODEL', model: update(model(), msg) });
  };

  const refKeyOf = (key: FieldKey): FormFieldRef => {
    if (key.startsWith('obj:')) {
      return { kind: 'objectNumber', fieldObjectNumber: Number(key.slice(4)) };
    }
    return { kind: 'fqn', name: key.slice(4) };
  };

  // ── snapshot loading ────────────────────────────────────────────────────
  let loading = false;
  const refresh = async (): Promise<void> => {
    const doc = ctx.doc;
    if (!doc || loading) return;
    loading = true;
    try {
      const snapshot = await doc.forms.list();
      apply({ t: 'snapshot', snapshot });
    } finally {
      loading = false;
    }
  };

  // ── widget geometry (from the WIDGET plane: one annotations read/page) ──
  const geomLoading = new Set<number>();
  const ensureGeom = (pon: number): void => {
    const doc = ctx.doc;
    if (!doc || geomLoading.has(pon) || model().geom[pon]) return;
    const crop = ctx.document()?.pages.find((p) => p.pageObjectNumber === pon)?.boxes.crop;
    if (!crop) return;
    geomLoading.add(pon);
    void doc
      .page(pon)
      .annotations.list()
      .then(({ annotations }) => {
        const boxes: Record<number, Box> = {};
        for (const dto of annotations) {
          if (dto.subtype !== 'widget') continue;
          const objectNumber = dto.ref.kind === 'objectNumber' ? dto.ref.annotObjectNumber : 0;
          if (objectNumber > 0) boxes[objectNumber] = toBox(dto.rect, crop);
        }
        apply({ t: 'pageGeom', pageObjectNumber: pon, boxes });
      })
      .finally(() => {
        geomLoading.delete(pon);
      });
  };

  // ── memoized fill projection ────────────────────────────────────────────
  const fillCache = new Map<number, { seq: number; items: FillItem[] }>();
  const fillItems = (pon: number): FillItem[] => {
    const m = model();
    const hit = fillCache.get(pon);
    if (hit && hit.seq === m.seq) return hit.items;
    const items = coreFillItems(m, pon);
    fillCache.set(pon, { seq: m.seq, items });
    return items;
  };

  // Single-widget projection — reference-stable per model.seq so framework
  // selectors can use plain identity equality.
  const fillItemCache = new Map<number, { seq: number; item: FillItem | null }>();
  const fillItem = (annotObjectNumber: number): FillItem | null => {
    const m = model();
    const hit = fillItemCache.get(annotObjectNumber);
    if (hit && hit.seq === m.seq) return hit.item;
    const item = coreFillItemForWidget(m, annotObjectNumber);
    fillItemCache.set(annotObjectNumber, { seq: m.seq, item });
    return item;
  };

  // ── typed writes: writeStart → engine → writeDone/writeFailed ──────────
  const write = async (key: FieldKey, value: FormFieldValue): Promise<void> => {
    const doc = ctx.doc;
    if (!doc) return;
    apply({ t: 'writeStart', key });
    try {
      const result = await doc.forms.setValue(refKeyOf(key), value);
      apply({ t: 'writeDone', key, field: result.field });
    } catch (err) {
      apply({ t: 'writeFailed', key });
      throw err;
    }
  };

  const can = (cap: 'doc.forms.fill' | 'doc.forms.modify'): boolean =>
    ctx.doc?.security.allows(cap) ?? false;

  // ── design mode ──────────────────────────────────────────────────────────
  // The annotation plane must re-read pages whose widget population changed
  // underneath it (created/deleted widgets); optional — fill-only setups
  // simply have no annotation plugin to nudge.
  const annotationHost = ctx.tryGet(AnnotationHostToken);
  const nudgeAnnotations = (pons: Iterable<number>): void => {
    if (!annotationHost) return;
    for (const pon of new Set(pons)) annotationHost.reloadPage(pon);
  };

  /** Content-space box → PDF rect (inverse of `toBox`). */
  const toPdfRect = (
    box: { x: number; y: number; width: number; height: number },
    crop: PdfRect,
  ): PdfRect => ({
    left: box.x + crop.left,
    top: crop.top - box.y,
    right: box.x + crop.left + box.width,
    bottom: crop.top - box.y - box.height,
  });

  const PLACE_DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
    text: { width: 160, height: 24 },
    checkbox: { width: 18, height: 18 },
    radio: { width: 18, height: 18 },
    combobox: { width: 140, height: 24 },
    listbox: { width: 140, height: 72 },
  };

  const placeField = async (
    family: Exclude<FormFieldFamily, 'pushbutton' | 'signature' | 'unknown'>,
    pon: number,
    box: { x: number; y: number; width: number; height: number },
  ): Promise<void> => {
    const doc = ctx.doc;
    const crop = ctx.document()?.pages.find((p) => p.pageObjectNumber === pon)?.boxes.crop;
    if (!doc || !crop) return;
    // A click (degenerate box) places the family's default size, centred.
    const size = PLACE_DEFAULT_SIZE[family]!;
    const placed =
      box.width < 4 || box.height < 4
        ? { x: box.x - size.width / 2, y: box.y - size.height / 2, ...size }
        : box;
    const name = `${family}_${Math.random().toString(36).slice(2, 6)}`;
    const placement = { pageObjectNumber: pon, rect: toPdfRect(placed, crop) };
    const draft: FormFieldDraft =
      family === 'radio'
        ? { family, name, widgets: [{ ...placement, onState: 'option1' }] }
        : family === 'combobox' || family === 'listbox'
          ? {
              family,
              name,
              widget: placement,
              options: [
                { label: 'Option 1', value: 'Option 1' },
                { label: 'Option 2', value: 'Option 2' },
              ],
            }
          : { family, name, widget: placement };
    await doc.forms.createField(draft);
    await refresh();
    apply({ t: 'clearGeom', pageObjectNumber: pon });
    nudgeAnnotations([pon]);
  };

  const updateField = async (key: FieldKey, patch: FormFieldPatch): Promise<void> => {
    const doc = ctx.doc;
    if (!doc) return;
    await doc.forms.updateField(refKeyOf(key), patch);
    await refresh();
  };

  const deleteField = async (key: FieldKey): Promise<void> => {
    const doc = ctx.doc;
    if (!doc) return;
    const field = fieldByKey(model(), key);
    const pons = field?.widgets.map((w) => w.pageObjectNumber).filter((p) => p > 0) ?? [];
    await doc.forms.deleteField(refKeyOf(key));
    await refresh();
    for (const pon of new Set(pons)) apply({ t: 'clearGeom', pageObjectNumber: pon });
    nudgeAnnotations(pons);
  };

  const detachWidget = async (key: FieldKey, annotObjectNumber: number): Promise<void> => {
    const doc = ctx.doc;
    if (!doc) return;
    const field = fieldByKey(model(), key);
    const widget = field?.widgets.find((w) => w.annotObjectNumber === annotObjectNumber);
    await doc.forms.detachWidget(refKeyOf(key), {
      annotObjectNumber,
      pageObjectNumber: widget?.pageObjectNumber ?? 0,
    });
    await refresh();
    if (widget && widget.pageObjectNumber > 0) {
      apply({ t: 'clearGeom', pageObjectNumber: widget.pageObjectNumber });
      nudgeAnnotations([widget.pageObjectNumber]);
    }
  };

  void refresh();

  return {
    snapshot: () => model().snapshot,
    refresh,
    fillItems,
    fillItem,
    ensureGeom,
    field: (key) => fieldByKey(model(), key),
    fieldForWidget: (annotObjectNumber) => coreFieldForWidget(model(), annotObjectNumber),
    setText: (key, value) => write(key, { type: 'text', value }),
    toggle: (key, onState) => write(key, { type: 'toggle', state: onState }),
    choose: (key, values) => write(key, { type: 'choice', values }),
    reset: async (key) => {
      const doc = ctx.doc;
      if (!doc) return;
      apply({ t: 'writeStart', key });
      try {
        const result = await doc.forms.reset(refKeyOf(key));
        apply({ t: 'writeDone', key, field: result.field });
      } catch (err) {
        apply({ t: 'writeFailed', key });
        throw err;
      }
    },
    setValue: async (ref, value) => {
      const doc = ctx.doc;
      if (!doc) throw new Error('no document');
      const result = await doc.forms.setValue(ref, value);
      await refresh();
      return result;
    },
    exportData: async (format: FormDataFormat = 'xfdf') => {
      const doc = ctx.doc;
      if (!doc) throw new Error('no document');
      return doc.forms.exportData(format);
    },
    importData: async (data, format) => {
      const doc = ctx.doc;
      if (!doc) throw new Error('no document');
      const result = await doc.forms.importData(data, format);
      apply({ t: 'snapshot', snapshot: result.snapshot });
      return result;
    },
    repair: async (options) => {
      const doc = ctx.doc;
      if (!doc) throw new Error('no document');
      const result = await doc.forms.repair(options);
      await refresh();
      return result;
    },
    placeField,
    updateField,
    deleteField,
    detachWidget,
    canFill: () => can('doc.forms.fill'),
    canModify: () => can('doc.forms.modify'),
  };
}
