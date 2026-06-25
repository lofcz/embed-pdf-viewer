import type { DocCapability, PluginContext } from '@embedpdf-x/kernel';
import type {
  AnnotationDraft,
  AnnotationDTO,
  AnnotationPatch,
  AnnotationRef,
} from '@embedpdf/engine-core/runtime';
import {
  chrome as coreChrome,
  cursorAt,
  defaultsFor,
  hitTest,
  pageItems as corePageItems,
  pdfToContentRect,
  update,
  type ChromeNode,
  type Effect,
  type LineEndings,
  type Model,
  type Msg,
  type RenderItem,
  type Style,
} from '@embedpdf-x/annotation-core';
import { fromDTO, refKey, toCreateDraft, toPatch } from './repository';
import type {
  AnnotationAction,
  AnnotationHostCapability,
  AnnotationState,
  Behavior,
} from './types';

const HANDLE_TOL = 6; // content units (PDF points)

/** Broad annotate-write capability (PDF bit 6). The engine independently
 *  enforces this AND the per-owner collab rules; `canEdit`/`canDelete` are the
 *  UI mirror of the coarse gate. */
const ANNOTATE_MODIFY: DocCapability = 'doc.annotate.modify';

const NO_ENDINGS: LineEndings = { start: 'none', end: 'none' };

/**
 * The annotation shell. The pure `update` runs HERE (so it can emit effects);
 * the resulting model is dispatched to the store, and each effect is performed
 * against the engine repository — optimistic create → reconcile to the durable
 * ref, patch/delete fire-and-forget.
 */
export function createAnnotationCapability(
  ctx: PluginContext<AnnotationState, AnnotationAction>,
): AnnotationHostCapability {
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
  const cropOf = (pon: number) =>
    ctx.document()?.pages.find((p) => p.pageObjectNumber === pon)?.boxes.crop ?? null;

  /** The page a ref lives on: from the loaded model first (covers obj/nm refs
   *  that don't carry a pon), else the ref itself (index refs do). */
  const ponForRef = (ref: AnnotationRef): number | null =>
    model().byId[refKey(ref)]?.pon ?? (ref.kind === 'index' ? ref.pageObjectNumber : null);

  /**
   * Re-sync one annotation into the model from the authoritative engine DTO,
   * with the render `source` the caller decides: `'vector'` when WE authored or
   * changed the appearance (create / restyle / resize), `'baked'` when the AP is
   * still authoritative (a move, which preserves it, or a remote edit).
   */
  const syncDTO = (dto: Parameters<typeof fromDTO>[0], source: 'baked' | 'vector'): void => {
    const crop = cropOf(dto.pageObjectNumber);
    if (crop) apply({ t: 'upsert', annots: [fromDTO(dto, crop, source)] });
  };

  /** The one engine-update path, shared by `update` and `updateSelection`. A
   *  programmatic patch changes the appearance → render live (vector). */
  const updateOne = async (ref: AnnotationRef, patch: AnnotationPatch): Promise<void> => {
    const doc = ctx.doc;
    if (!doc) throw new Error('[annotation] no document bound');
    const pon = ponForRef(ref);
    if (pon == null) throw new Error('[annotation] cannot resolve page for ref');
    const res = await doc.page(pon).annotations.update(ref, patch);
    syncDTO(res.updated, 'vector');
  };

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
          (res) => {
            // Reconcile temp→durable id (keeps selection/order), then attach the
            // authoritative DTO so the committed annotation is fully data-backed.
            apply({
              t: 'created',
              tempId: fx.id,
              id: refKey(res.created.ref),
              ref: res.created.ref,
            });
            // We just drew it — render live, not the engine's freshly-baked AP.
            syncDTO(res.created, 'vector');
          },
          () => apply({ t: 'createFailed', tempId: fx.id }),
        );
    } else if (fx.fx === 'patch') {
      const a = m.byId[fx.id];
      const crop = a && cropOf(a.pon);
      const patch = a && a.ref && crop ? toPatch(a, crop) : null;
      if (!a || !a.ref || !patch) return;
      // Re-sync from the authoritative DTO, PRESERVING the source the gesture
      // chose: a move kept it baked (raster rides along), a resize flipped it to
      // vector. So the round-trip can't silently re-bake an edited annotation.
      const source = a.source;
      doc
        .page(a.pon)
        .annotations.update(a.ref, patch)
        .then(
          (res) => syncDTO(res.updated, source),
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
    // ── data API: create / update / delete (engine-routed, ref-addressed) ──
    create: async (pon, draft: AnnotationDraft): Promise<AnnotationRef> => {
      const doc = ctx.doc;
      if (!doc) throw new Error('[annotation] no document bound');
      const res = await doc.page(pon).annotations.create(draft);
      syncDTO(res.created, 'vector');
      return res.created.ref;
    },
    update: (ref: AnnotationRef, patch: AnnotationPatch) => updateOne(ref, patch),
    /**
     * Sugar: restyle the current selection. For each selected annotation it
     * applies the change to a copy, runs it through the full content→engine
     * converter (so cloudy `/RD`, endings, and per-kind fields are all handled
     * correctly), and issues one engine `update`. Pure convenience over
     * {@link update}; the model re-syncs from each authoritative DTO.
     */
    updateSelection: async (patch: {
      style?: Partial<Style>;
      endings?: Partial<LineEndings>;
    }): Promise<void> => {
      const m = model();
      const writes: Array<Promise<void>> = [];
      for (const id of m.selected) {
        const a = m.byId[id];
        if (!a?.ref) continue;
        const crop = cropOf(a.pon);
        if (!crop) continue;
        let next = a;
        if (patch.style) next = { ...next, style: { ...next.style, ...patch.style } };
        if (patch.endings && (next.geom.t === 'line' || next.geom.t === 'poly')) {
          next = {
            ...next,
            geom: { ...next.geom, ends: { ...(next.geom.ends ?? NO_ENDINGS), ...patch.endings } },
          };
        }
        const ep = toPatch(next, crop);
        if (ep) writes.push(updateOne(a.ref, ep));
      }
      await Promise.all(writes);
    },
    delete: async (ref: AnnotationRef): Promise<void> => {
      const doc = ctx.doc;
      if (!doc) throw new Error('[annotation] no document bound');
      const pon = ponForRef(ref);
      if (pon == null) throw new Error('[annotation] cannot resolve page for ref');
      await doc.page(pon).annotations.delete(ref);
      apply({ t: 'remove', ids: [refKey(ref)] });
    },

    // ── authorization (coarse UI mirror; engine enforces per-owner) ──
    canCreate: () => ctx.doc?.security.allows(ANNOTATE_MODIFY) ?? false,
    canEdit: () => ctx.doc?.security.allows(ANNOTATE_MODIFY) ?? false,
    canDelete: () => ctx.doc?.security.allows(ANNOTATE_MODIFY) ?? false,

    getSelection: (): AnnotationRef[] => {
      const m = model();
      return m.selected.map((id) => m.byId[id]?.ref).filter((r): r is AnnotationRef => r != null);
    },

    // ── DTO-returning reads (canonical engine vocabulary) ──
    get: (ref: AnnotationRef): AnnotationDTO | null => model().byId[refKey(ref)]?.data ?? null,
    list: (pon: number): AnnotationDTO[] => {
      const m = model();
      return m.order
        .map((id) => m.byId[id])
        .filter((a) => a?.pon === pon)
        .map((a) => a?.data)
        .filter((d): d is AnnotationDTO => d != null);
    },
    getSelected: (): AnnotationDTO[] => {
      const m = model();
      return m.selected.map((id) => m.byId[id]?.data).filter((d): d is AnnotationDTO => d != null);
    },

    // selectors
    pageItems: (pon) => memoItems(pon),
    chrome: (pon) => memoChrome(pon),
    selection: () => model().selected,
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
          (snap) => apply({ t: 'loaded', annots: snap.annotations.map((d) => fromDTO(d, crop)) }),
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
