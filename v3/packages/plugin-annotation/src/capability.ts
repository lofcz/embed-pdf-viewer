import type { DocCapability, PluginContext } from '@embedpdf-x/kernel';
import {
  resolveBinarySource,
  sniffBinaryMetadata,
  type AnnotationDraft,
  type AnnotationDTO,
  type AnnotationPatch,
  type AnnotationRef,
  type BinarySource,
} from '@embedpdf/engine-core/runtime';
import { InteractionToken } from '@embedpdf-x/plugin-interaction';
import {
  chrome as coreChrome,
  contentToPdfPoint,
  creationDraftAnchor as coreCreationDraftAnchor,
  cursorAt,
  defaultsFor,
  expandGroups,
  groupKeyOf,
  hitTest,
  pageItems as corePageItems,
  pdfToContentRect,
  propsFor,
  readProp,
  selectionAnchor as coreSelectionAnchor,
  sharedProps,
  update,
  type Annot,
  type AnnotationProps,
  type ChromeNode,
  type CreationDraftAnchor,
  type Effect,
  type Model,
  type Msg,
  type PropKey,
  type Rect,
  type RenderItem,
  type Vec,
} from '@embedpdf-x/annotation-core';
import { fromDTO, refKey, toCreateDraft, toPatch } from './repository';
import { buildTextItems } from './text-item';
import type {
  AnnotationAction,
  AnnotationHostCapability,
  AnnotationState,
  Behavior,
  SelectionProps,
  TextItem,
} from './types';

const HANDLE_TOL = 6; // content units (PDF points)

/** Broad annotate-write capability (PDF bit 6). The engine independently
 *  enforces this AND the per-owner collab rules; `canEdit`/`canDelete` are the
 *  UI mirror of the coarse gate. */
const ANNOTATE_MODIFY: DocCapability = 'doc.annotate.modify';

const TEXT_COMMIT_DEBOUNCE_MS = 250;

/** Tools whose target KIND has a different id (the props/defaults lens for a
 *  tool resolves through this: a callout edits free-text properties). */
const TOOL_KIND: Record<string, string> = {
  'free-text-callout': 'free-text',
  'insert-text': 'caret',
};

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
  /** Per-annotation debounce timer for the engine `contents` write while typing. */
  const textTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  // Anchor for the selection menu — memoized by model identity so the selector
  // returns a stable reference between unrelated dispatches.
  let anchorCache: { model: Model; v: { pon: number; bounds: Rect; knob?: Vec } | null } | null =
    null;
  const memoAnchor = (): { pon: number; bounds: Rect; knob?: Vec } | null => {
    const m = model();
    if (anchorCache && anchorCache.model === m) return anchorCache.v;
    const v = coreSelectionAnchor(m);
    anchorCache = { model: m, v };
    return v;
  };
  let draftAnchorCache: { model: Model; v: CreationDraftAnchor | null } | null = null;
  const memoDraftAnchor = (): CreationDraftAnchor | null => {
    const m = model();
    if (draftAnchorCache && draftAnchorCache.model === m) return draftAnchorCache.v;
    const v = coreCreationDraftAnchor(m);
    draftAnchorCache = { model: m, v };
    return v;
  };
  // The selection's property schema + values — memoized by model identity so a
  // subscribed sidebar re-renders only when the model actually changed.
  let selPropsCache: { model: Model; v: SelectionProps } | null = null;
  const memoSelectionProps = (): SelectionProps => {
    const m = model();
    if (selPropsCache && selPropsCache.model === m) return selPropsCache.v;
    const members = m.selected.map((id) => m.byId[id]).filter((a): a is Annot => !!a);
    const specs = sharedProps(members.map((a) => a.subtype));
    const values: Partial<AnnotationProps> = {};
    const mixed: PropKey[] = [];
    for (const spec of specs) {
      const first = readProp(members[0], spec.key);
      (values as Record<PropKey, unknown>)[spec.key] = first;
      const firstJson = JSON.stringify(first);
      if (members.some((a) => JSON.stringify(readProp(a, spec.key)) !== firstJson))
        mixed.push(spec.key);
    }
    const v: SelectionProps = { specs, values, mixed };
    selPropsCache = { model: m, v };
    return v;
  };
  const textsCache = new Map<number, { model: Model; v: TextItem[] }>();
  const memoTexts = (pon: number): TextItem[] => {
    const m = model();
    const c = textsCache.get(pon);
    if (c && c.model === m) return c.v;
    const v = buildTextItems(m, pon);
    textsCache.set(pon, { model: m, v });
    return v;
  };
  const cropOf = (pon: number) =>
    ctx.document()?.pages.find((p) => p.pageObjectNumber === pon)?.boxes.crop ?? null;
  /** The page's box in content space (origin at the crop top-left) — the box
   *  pointer gestures clamp to, so annotations stay page-bound. */
  const pageBoxOf = (pon: number): Rect | undefined => {
    const crop = cropOf(pon);
    return crop
      ? { x: 0, y: 0, width: crop.right - crop.left, height: crop.top - crop.bottom }
      : undefined;
  };

  /**
   * The armed stamp-tool payload: the bytes the next click places, plus the
   * PDF-point placement size (derived from the sniffed intrinsic aspect).
   * Transient tool state — deliberately NOT in the model: it is never
   * rendered, never synced, and dies with the tool.
   */
  let armedStamp: { source: BinarySource; width: number; height: number } | null = null;

  const armStamp = async (input: { source: BinarySource; targetWidth?: number }): Promise<void> => {
    // Resolve + sniff up front: a bad payload fails HERE (at the button),
    // not at the click. The original `source` is kept for the create call —
    // normalization inside the engine handles it again from scratch.
    const resolved = await resolveBinarySource(input.source);
    const meta = sniffBinaryMetadata(resolved.bytes);
    if (!meta) {
      throw new Error('[annotation] stamp source must be PNG, JPEG, or single-page PDF bytes');
    }
    const width = input.targetWidth ?? 150;
    const aspect = 'width' in meta && meta.width > 0 ? meta.height / meta.width : 1;
    armedStamp = { source: input.source, width, height: width * aspect };
    ctx.tryGet(InteractionToken)?.activateTool('stamp');
  };

  const disarmStamp = (): void => {
    armedStamp = null;
  };

  const placeArmedStamp = (pon: number, point: Vec): boolean => {
    const armed = armedStamp;
    const doc = ctx.doc;
    const crop = cropOf(pon);
    if (!armed || !doc || !crop) return false;
    const c = contentToPdfPoint(point, crop);
    const rect = {
      left: c.x - armed.width / 2,
      bottom: c.y - armed.height / 2,
      right: c.x + armed.width / 2,
      top: c.y + armed.height / 2,
    };
    doc
      .page(pon)
      .annotations.create({ subtype: 'stamp', rect, source: armed.source, fit: 'contain' })
      .then(
        // A stamp has no vector render — the engine-baked /AP IS the visual.
        (res) => syncDTO(res.created, 'baked'),
        (err) => console.error('[annotation] stamp placement failed:', err),
      );
    return true;
  };

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

  /** A relationship-only engine patch (sets/clears `/IRT` + `/RT`) — geometry and
   *  style are left untouched, so grouping never re-bakes an appearance. */
  const relationshipPatch = (
    subtype: AnnotationDTO['subtype'],
    rel: { inReplyTo: AnnotationRef | null; replyType?: 'group' },
  ): AnnotationPatch => ({ subtype, ...rel }) as AnnotationPatch;

  /** Write a relationship change to one committed annotation and re-sync it from
   *  the authoritative DTO (preserving its render source — relationships don't
   *  change the appearance). */
  const writeRelationship = async (
    a: Annot,
    rel: { inReplyTo: AnnotationRef | null; replyType?: 'group' },
  ): Promise<void> => {
    const doc = ctx.doc;
    if (!doc || !a.ref || !a.data) return;
    const res = await doc
      .page(a.pon)
      .annotations.update(a.ref, relationshipPatch(a.data.subtype, rel));
    syncDTO(res.updated, a.source);
  };

  /** Committed, data-backed annotations in the current selection. */
  const selectedCommitted = (): Annot[] => {
    const m = model();
    return m.selected.map((id) => m.byId[id]).filter((a): a is Annot => !!a && !!a.ref && !!a.data);
  };

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
      // Stamps have no vector render — their engine-baked /AP is the visual.
      syncDTO(res.created, res.created.subtype === 'stamp' ? 'baked' : 'vector');
      return res.created.ref;
    },
    armStamp,
    disarmStamp,
    placeArmedStamp,
    update: (ref: AnnotationRef, patch: AnnotationPatch) => updateOne(ref, patch),
    // Restyle the selection: ONE flat props patch through the pure core (the
    // same `update → patch effect → toPatch` path every gesture takes). Each
    // member takes the keys its kind declares and ignores the rest; the model
    // updates optimistically, the engine writes fire per member and re-sync.
    updateSelection: (patch) => apply({ t: 'setProps', patch }),
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

    // ── property introspection (the schema a sidebar renders from) ──
    getSelectionProps: () => memoSelectionProps(),
    propsForTool: (toolId) => propsFor(TOOL_KIND[toolId] ?? toolId),

    // selectors
    pageItems: (pon) => memoItems(pon),
    chrome: (pon) => memoChrome(pon),
    selectionAnchor: () => memoAnchor(),
    creationDraftAnchor: () => memoDraftAnchor(),
    selection: () => model().selected,
    hitKind: (pon, point) => hitTest(model(), pon, point, HANDLE_TOL, model().hitMargin).t,
    cursorAt: (pon, point) => cursorAt(model(), pon, point, HANDLE_TOL, model().hitMargin),
    behaviorFor: (a) => behaviors.find((b) => b.matches(a) && b.engaged()) ?? null,

    appearanceEpoch: (pon) => {
      const m = model();
      const parts: string[] = [];
      for (const id of m.order) {
        const a = m.byId[id];
        if (!a || a.pon !== pon || a.source !== 'baked' || !a.ref) continue;
        const b = a.apBox;
        // 1dp rounding: the gesture-committed box and the DTO-synced box may
        // differ by float noise — that must not read as a second epoch.
        parts.push(
          b
            ? `${id}@${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`
            : id,
        );
      }
      return parts.sort().join('|');
    },
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
      apply({ t: 'editPointer', phase, in: { pon, point, shift, pageBox: pageBoxOf(pon) } }),
    marqueePointer: (phase, pon, point, shift) =>
      apply({ t: 'marqueePointer', phase, in: { pon, point, shift, pageBox: pageBoxOf(pon) } }),
    createPointer: (subtype, phase, pon, point, finish = false) =>
      apply({
        t: 'createPointer',
        phase,
        subtype,
        in: { pon, point, shift: false, finish, pageBox: pageBoxOf(pon) },
      }),
    finishCreationDraft: () => apply({ t: 'finishCreationDraft' }),
    cancelCreationDraft: () => apply({ t: 'cancel' }),
    createMarkup: (subtype, pon, rects) => apply({ t: 'createMarkup', subtype, pon, rects }),
    createCaret: (pon, textEndRect) => apply({ t: 'createCaret', pon, rect: textEndRect }),
    previewMarkup: (subtype, rectsByPage) => apply({ t: 'setMarkupPreview', subtype, rectsByPage }),
    clearMarkupPreview: () => apply({ t: 'clearMarkupPreview' }),
    setDefaults: (subtype, patch) => apply({ t: 'setDefaults', subtype, patch }),
    currentDefaults: (subtype) => defaultsFor(model(), subtype),
    deleteSelection: () => apply({ t: 'delete' }),
    deselect: () => apply({ t: 'deselect' }),
    cancel: () => apply({ t: 'cancel' }),
    // Rotate the selection a quarter-turn clockwise / reset it to as-authored.
    // Both commit one geometry patch per rotatable member (the same path the
    // rotate-knob gesture uses), so they round-trip through the engine identically.
    rotateSelection90: () => apply({ t: 'rotate90' }),
    resetSelectionRotation: () => apply({ t: 'resetRotation' }),

    // ── grouping (engine `/IRT` + `/RT /Group`; page-local) ──
    /** Group the current selection into one unit: the bottom-most member becomes
     *  the primary, every other member becomes a `/RT /Group` subordinate of it.
     *  No-op unless 2+ committed annotations on a single page are selected. */
    group: async (): Promise<void> => {
      const m = model();
      const members = selectedCommitted();
      if (members.length < 2) return;
      const pon = members[0].pon;
      if (members.some((a) => a.pon !== pon)) return; // groups are page-local
      const ordered = [...members].sort((a, b) => m.order.indexOf(a.id) - m.order.indexOf(b.id));
      const [primary, ...rest] = ordered;
      if (!primary.ref) return;
      await Promise.all(
        rest.map((a) => writeRelationship(a, { inReplyTo: primary.ref, replyType: 'group' })),
      );
    },
    /** Ungroup: clear `/IRT` (+ `/RT`) on every subordinate in the group(s) the
     *  selection touches, so each member becomes top-level again. */
    ungroup: async (): Promise<void> => {
      const m = model();
      const subs = expandGroups(m, m.selected)
        .map((id) => m.byId[id])
        .filter((a): a is Annot => !!a && !!a.ref && !!a.data && !!a.group);
      await Promise.all(subs.map((a) => writeRelationship(a, { inReplyTo: null })));
    },
    canGroup: (): boolean => {
      if (!(ctx.doc?.security.allows(ANNOTATE_MODIFY) ?? false)) return false;
      const m = model();
      const members = selectedCommitted();
      if (members.length < 2) return false;
      if (members.some((a) => a.pon !== members[0].pon)) return false;
      // Already exactly one complete group → nothing to do.
      const keys = new Set(m.selected.map((id) => groupKeyOf(m, id)));
      if (keys.size === 1 && !keys.has(null)) return false;
      return true;
    },
    canUngroup: (): boolean => {
      if (!(ctx.doc?.security.allows(ANNOTATE_MODIFY) ?? false)) return false;
      const m = model();
      return m.selected.some((id) => groupKeyOf(m, id) != null);
    },

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

    // ── free-text (the editable-element layer) ──
    textItems: (pon) => memoTexts(pon),
    currentEditing: () => model().editing,
    beginTextEdit: (ref) => apply({ t: 'beginTextEdit', id: refKey(ref) }),
    beginTextEditAt: (pon, point) => {
      const m = model();
      const h = hitTest(m, pon, point, HANDLE_TOL, m.hitMargin);
      // A double-click on the box body OR one of its resize handles both target the
      // same annotation; either should open it for editing.
      const id = h.t === 'annot' || h.t === 'handle' ? h.id : null;
      if (id != null && m.byId[id]?.geom.t === 'text') apply({ t: 'beginTextEdit', id });
    },
    setContents: (ref, text) => {
      apply({ t: 'setText', id: refKey(ref), text }); // optimistic, no engine churn
      const key = refKey(ref);
      clearTimeout(textTimers.get(key));
      textTimers.set(
        key,
        setTimeout(() => {
          textTimers.delete(key);
          const pon = ponForRef(ref);
          if (pon != null) {
            ctx.doc
              ?.page(pon)
              .annotations.update(ref, { subtype: 'free-text', contents: text })
              .then(
                () => {},
                () => {},
              );
          }
        }, TEXT_COMMIT_DEBOUNCE_MS),
      );
    },
    endTextEdit: () => {
      // flush any pending debounced write immediately, then leave edit mode
      for (const t of textTimers.values()) clearTimeout(t);
      const id = model().editing;
      const a = id ? model().byId[id] : null;
      if (a?.ref) {
        const pon = ponForRef(a.ref);
        const text = a.data?.contents ?? '';
        if (pon != null)
          ctx.doc
            ?.page(pon)
            .annotations.update(a.ref, { subtype: 'free-text', contents: text })
            .then(
              () => {},
              () => {},
            );
      }
      textTimers.clear();
      apply({ t: 'endTextEdit' });
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
