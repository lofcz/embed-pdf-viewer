import type { PluginContext } from '@embedpdf-x/kernel';
import {
  chrome as coreChrome,
  cursorAt,
  defaultsFor,
  hitTest,
  pageItems as corePageItems,
  pdfToContentRect,
  selectedItems as coreSelectedItems,
  update,
  type ChromeNode,
  type Effect,
  type Model,
  type Msg,
  type RenderItem,
} from '@embedpdf-x/annotation-core';
import { fromDTO, refKey, toCreateDraft, toPatch } from './repository';
import type { AnnotationAction, AnnotationCapability, AnnotationState, Behavior } from './types';

const HANDLE_TOL = 6; // content units (PDF points)

/**
 * The annotation shell. The pure `update` runs HERE (so it can emit effects);
 * the resulting model is dispatched to the store, and each effect is performed
 * against the engine repository — optimistic create → reconcile to the durable
 * ref, patch/delete fire-and-forget.
 */
export function createAnnotationCapability(
  ctx: PluginContext<AnnotationState, AnnotationAction>,
): AnnotationCapability {
  const loaded = new Set<number>();
  const behaviors: Behavior[] = [];

  const model = (): Model => ctx.getState().model;

  // Memoize the derived per-page arrays by model identity, so a selector returns
  // a STABLE reference between dispatches (useSyncExternalStore needs this — the
  // model object only changes when `update` produces a new one).
  const itemsCache = new Map<number, { model: Model; v: RenderItem[] }>();
  const chromeCache = new Map<number, { model: Model; v: ChromeNode[] }>();
  const memoItems = (pon: number): RenderItem[] => {
    const m = model();
    const c = itemsCache.get(pon);
    if (c && c.model === m) return c.v;
    const v = corePageItems(m, pon);
    itemsCache.set(pon, { model: m, v });
    return v;
  };
  const memoChrome = (pon: number): ChromeNode[] => {
    const m = model();
    const c = chromeCache.get(pon);
    if (c && c.model === m) return c.v;
    const v = coreChrome(m, pon);
    chromeCache.set(pon, { model: m, v });
    return v;
  };
  let selCache: { model: Model; v: RenderItem[] } | null = null;
  const memoSelected = (): RenderItem[] => {
    const m = model();
    if (selCache && selCache.model === m) return selCache.v;
    const v = coreSelectedItems(m);
    selCache = { model: m, v };
    return v;
  };
  const cropOf = (pon: number) =>
    ctx.document()?.pages.find((p) => p.pageObjectNumber === pon)?.boxes.crop ?? null;

  function apply(msg: Msg): void {
    const [next, effects] = update(model(), msg);
    ctx.dispatch({ type: 'SET_MODEL', model: next });
    for (const fx of effects) perform(fx, next);
  }

  function perform(fx: Effect, m: Model): void {
    const doc = ctx.doc;
    if (!doc) return;
    if (fx.fx === 'create') {
      const a = m.byId[fx.id];
      const crop = a && cropOf(a.pon);
      const draft = a && crop ? toCreateDraft(a, crop) : null;
      if (!a || !draft) return;
      doc
        .page(a.pon)
        .annotations.create(draft)
        .then(
          (res) =>
            apply({
              t: 'created',
              tempId: fx.id,
              id: refKey(res.created.ref),
              ref: res.created.ref,
            }),
          () => apply({ t: 'createFailed', tempId: fx.id }),
        );
    } else if (fx.fx === 'patch') {
      const a = m.byId[fx.id];
      const crop = a && cropOf(a.pon);
      const patch = a && a.ref && crop ? toPatch(a, crop) : null;
      if (!a || !a.ref || !patch) return;
      doc
        .page(a.pon)
        .annotations.update(a.ref, patch)
        .then(
          () => {},
          () => {},
        );
    } else {
      doc
        .page(fx.ref.pageObjectNumber)
        .annotations.delete(fx.ref)
        .then(
          () => {},
          () => {},
        );
    }
  }

  return {
    // selectors
    pageItems: (pon) => memoItems(pon),
    chrome: (pon) => memoChrome(pon),
    selection: () => model().selected,
    selectedItems: () => memoSelected(),
    currentStyle: () => model().style,
    hitKind: (pon, point) => hitTest(model(), pon, point, HANDLE_TOL, model().hitMargin).t,
    cursorAt: (pon, point) => cursorAt(model(), pon, point, HANDLE_TOL, model().hitMargin),
    behaviorFor: (a) => behaviors.find((b) => b.matches(a) && b.engaged()) ?? null,

    appearances: (pon, scale, signal) => {
      const doc = ctx.doc;
      if (!doc) return Promise.resolve([]);
      const task = doc.page(pon).annotations.renderAppearanceImages({ scale });
      if (signal) {
        if (signal.aborted) task.abort(signal.reason);
        else signal.addEventListener('abort', () => task.abort(signal.reason), { once: true });
      }
      return task.then(
        (r) => r.appearances,
        () => [],
      );
    },
    toContentBox: (pon, rect) => {
      const crop = cropOf(pon);
      return crop ? pdfToContentRect(rect, crop) : null;
    },

    // intents
    editPointer: (phase, pon, point, shift) =>
      apply({ t: 'editPointer', phase, in: { pon, point, shift } }),
    createPointer: (subtype, phase, pon, point) =>
      apply({ t: 'createPointer', phase, subtype, in: { pon, point, shift: false } }),
    createMarkup: (subtype, pon, rects) => apply({ t: 'createMarkup', subtype, pon, rects }),
    previewMarkup: (subtype, rectsByPage) => apply({ t: 'setMarkupPreview', subtype, rectsByPage }),
    clearMarkupPreview: () => apply({ t: 'clearMarkupPreview' }),
    setStyle: (patch) => apply({ t: 'setStyle', patch }),
    setEndings: (patch) => apply({ t: 'setEndings', patch }),
    setDefaults: (subtype, patch) => apply({ t: 'setDefaults', subtype, patch }),
    currentDefaults: (subtype) => defaultsFor(model(), subtype),
    deleteSelection: () => apply({ t: 'delete' }),
    deselect: () => apply({ t: 'deselect' }),
    cancel: () => apply({ t: 'cancel' }),

    ensurePage: (pon) => {
      if (loaded.has(pon)) return;
      const doc = ctx.doc;
      const crop = cropOf(pon);
      if (!doc || !crop) return;
      loaded.add(pon);
      doc
        .page(pon)
        .annotations.list()
        .then(
          (snap) =>
            apply({ t: 'loaded', pon, annots: snap.annotations.map((d) => fromDTO(d, crop)) }),
          () => {
            loaded.delete(pon);
          },
        );
    },

    registerBehavior: (b) => {
      behaviors.push(b);
      return () => {
        const i = behaviors.indexOf(b);
        if (i >= 0) behaviors.splice(i, 1);
      };
    },
  };
}
