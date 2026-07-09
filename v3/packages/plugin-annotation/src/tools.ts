/**
 * The annotation TOOL registry — the one place that says which tools exist and
 * what each one authors. A tool is a named authoring PRESET, not a new kind: it
 * binds an `id` to a PDF `subtype`, a bag of per-tool `defaults`, a cursor, and
 * the interaction TAGS it turns on. Two tools can share a subtype but differ in
 * defaults (an "arrow" is a `line` with an arrowhead default), which is exactly
 * why defaults are keyed by the tool id (the `preset`), never by the subtype.
 *
 * The built-in {@link DEFAULT_TOOLS} reproduce v2's tool set; an embedder tweaks
 * or extends them with `annotationPlugin({ tools: [...] })`. Same-id entries MERGE
 * over the built-in (configure it); a new id ADDS a tool; `extends` inherits an
 * existing tool's subtype/cursor/tags so a preset is one line.
 */
import type { AnnotationPropsPatch, Subtype } from '@embedpdf-x/annotation-core';
import type { BinarySource } from '@embedpdf/engine-core/runtime';

/**
 * How a stamp-family tool resolves the image bytes it places — pure DATA, so a
 * tool table stays JSON-serializable (config can come from a file, a DB, or the
 * server). Evaluated at CLICK time, so the user picks the spot first, then the
 * source:
 *   - `{ kind: 'bytes' }` — fixed bytes: a company rubber-stamp.
 *   - `{ kind: 'prompt' }` — ask the environment for bytes. The plugin does NOT
 *     know how (a file dialog is DOM); a {@link StampProvider} port, installed by
 *     the framework adapter, fulfils it. Resolve `null` there to cancel.
 */
export type StampSourceSpec = { kind: 'bytes'; source: BinarySource } | { kind: 'prompt' };

/**
 * A tool definition — the public config vocabulary. Every field except `id` is
 * optional: the common cases are "configure a built-in" (`{ id, defaults }`) and
 * "add a preset" (`{ id, extends, defaults }`).
 */
export interface AnnotationToolDef {
  /** Stable tool id — the value passed to `activateTool` and the `defaults` key. */
  id: string;
  /** Inherit `subtype` / `propsKind` / `cursor` / `enables` / `source` / `meta`
   *  from an existing tool id (a built-in or another entry). Own fields win. */
  extends?: string;
  /** The PDF subtype this tool authors (the geometry the core draws). Defaults to
   *  the inherited subtype, or the id when neither is given. */
  subtype?: Subtype;
  /** The kind whose editable-property specs a style panel shows for this tool.
   *  Defaults to `subtype` (a callout authors `free-text` props, for example). */
  propsKind?: string;
  /** ADVANCED: the `defaults` key this tool reads/writes. Defaults to the id, and
   *  that is almost always right — override it only to alias a shared defaults bag
   *  (the built-in insert-caret tool points its preset at the `caret` key). */
  preset?: string;
  /** Seed defaults for newly drawn annotations — the flat AnnotationProps patch,
   *  merged over any inherited defaults (line endings merge per side). */
  defaults?: AnnotationPropsPatch;
  /** The pointer cursor while this tool is active. Defaults inherited / `crosshair`. */
  cursor?: string;
  /** Interaction capability tags this tool enables (which handlers wake up). */
  enables?: string[];
  /** Stamp-family only: how the click-to-place source resolves ({@link StampSourceSpec}). */
  source?: StampSourceSpec;
  /** Opaque presentation hints (label/icon…) for a toolbar or badge that builds
   *  itself from the tool table. Never read by the plugin or the interaction hub. */
  meta?: Record<string, unknown>;
}

/** A fully-resolved tool — what the plugin, handlers, and registration loop read. */
export interface ResolvedTool {
  id: string;
  /** Routing token for the draw core + the created annotation's PDF subtype. */
  subtype: Subtype;
  /** The `defaults` key (always the tool id) — keeps same-subtype tools apart. */
  preset: string;
  /** The `propsFor` key for the style panel. */
  propsKind: string;
  cursor: string;
  enables: ReadonlySet<string>;
  defaults?: AnnotationPropsPatch;
  source?: StampSourceSpec;
  meta?: Record<string, unknown>;
}

// ── field groups shared by the built-ins (keeps the table readable) ──────────
const DRAW_TAGS = ['annotation-draw', 'annotation-edit'];
const MARKUP_TAGS = ['text-select', 'annotation-edit'];

/**
 * The built-in tools — a data mirror of v2's registrations (shapes + lines + ink
 * + free text in the draw channel, text markup + caret behind text selection, and
 * the click-to-place stamp). Order is display-neutral; the toolbar owns layout.
 */
export const DEFAULT_TOOLS: AnnotationToolDef[] = [
  // shapes / lines / ink / free text — the `annotation-draw` gesture
  { id: 'square', subtype: 'square', cursor: 'crosshair', enables: DRAW_TAGS },
  { id: 'circle', subtype: 'circle', cursor: 'crosshair', enables: DRAW_TAGS },
  { id: 'line', subtype: 'line', cursor: 'crosshair', enables: DRAW_TAGS },
  { id: 'polygon', subtype: 'polygon', cursor: 'crosshair', enables: DRAW_TAGS },
  { id: 'polyline', subtype: 'polyline', cursor: 'crosshair', enables: DRAW_TAGS },
  {
    id: 'ink',
    subtype: 'ink',
    cursor: 'crosshair',
    enables: DRAW_TAGS,
    defaults: { color: '#ef4444', strokeWidth: 3 },
  },
  {
    id: 'free-text',
    subtype: 'free-text',
    cursor: 'crosshair',
    enables: DRAW_TAGS,
    defaults: { fontColor: '#ef4444' },
  },
  {
    // Routes on the `free-text-callout` subtype token but authors a `free-text`
    // annotation (leader + box). Its leader defaults to an open arrowhead.
    id: 'free-text-callout',
    subtype: 'free-text-callout',
    propsKind: 'free-text',
    cursor: 'crosshair',
    enables: DRAW_TAGS,
    defaults: { strokeWidth: 1, lineEndings: { end: 'open-arrow' } },
  },
  // text markup — the `text-select` gesture (inert without a selection plugin)
  {
    id: 'highlight',
    subtype: 'highlight',
    cursor: 'text',
    enables: MARKUP_TAGS,
    defaults: { color: '#ffe16a' },
  },
  {
    id: 'underline',
    subtype: 'underline',
    cursor: 'text',
    enables: MARKUP_TAGS,
    defaults: { color: '#ef4444' },
  },
  {
    id: 'strikeout',
    subtype: 'strikeout',
    cursor: 'text',
    enables: MARKUP_TAGS,
    defaults: { color: '#ef4444' },
  },
  {
    id: 'squiggly',
    subtype: 'squiggly',
    cursor: 'text',
    enables: MARKUP_TAGS,
    defaults: { color: '#ef4444' },
  },
  {
    // The insert-caret tool authors a `caret` from a text selection. Its defaults
    // live under the `caret` preset — the key `createCaret` resolves.
    id: 'insert-text',
    subtype: 'caret',
    propsKind: 'caret',
    preset: 'caret',
    cursor: 'text',
    enables: MARKUP_TAGS,
    defaults: { color: '#ef4444', strokeWidth: 1 },
  },
  // stamp — click-to-place; 'prompt' asks the environment (the React adapter wires
  // a file dialog by default; an embedder can pass fixed bytes instead).
  {
    id: 'stamp',
    subtype: 'stamp',
    cursor: 'copy',
    enables: ['annotation-stamp', 'annotation-edit'],
    source: { kind: 'prompt' },
  },
];

/** Merge two default patches, `b` over `a`, with line endings merged per side. */
function mergeDefaults(
  a?: AnnotationPropsPatch,
  b?: AnnotationPropsPatch,
): AnnotationPropsPatch | undefined {
  if (!a) return b;
  if (!b) return a;
  const merged: AnnotationPropsPatch = { ...a, ...b };
  if (a.lineEndings || b.lineEndings) merged.lineEndings = { ...a.lineEndings, ...b.lineEndings };
  return merged;
}

/** Overlay a same-id override onto a base definition (configure a built-in). */
function mergeDef(base: AnnotationToolDef, over: AnnotationToolDef): AnnotationToolDef {
  return {
    ...base,
    ...over,
    enables: over.enables ?? base.enables,
    meta: base.meta || over.meta ? { ...base.meta, ...over.meta } : undefined,
    defaults: mergeDefaults(base.defaults, over.defaults),
  };
}

/**
 * Resolve {@link DEFAULT_TOOLS} + embedder overrides into the ready-to-use table.
 * A same-id override merges over the built-in; a new id adds a tool; `extends`
 * inherits from an already-defined tool. Keyed by id, so lookups are O(1).
 */
export function buildToolRegistry(overrides: AnnotationToolDef[] = []): Map<string, ResolvedTool> {
  const defs = new Map<string, AnnotationToolDef>();
  for (const d of DEFAULT_TOOLS) defs.set(d.id, d);
  for (const o of overrides) {
    const prev = defs.get(o.id);
    defs.set(o.id, prev ? mergeDef(prev, o) : o);
  }

  const out = new Map<string, ResolvedTool>();
  const resolving = new Set<string>();
  const resolve = (id: string): ResolvedTool => {
    const cached = out.get(id);
    if (cached) return cached;
    const def = defs.get(id);
    if (!def) throw new Error(`[annotation] tool '${id}' extends an unknown tool`);
    // Inherit from the base first (guarding self / cyclic extends), then own fields win.
    let base: ResolvedTool | undefined;
    if (def.extends && def.extends !== id && !resolving.has(def.extends)) {
      resolving.add(id);
      base = resolve(def.extends);
      resolving.delete(id);
    }
    const subtype = (def.subtype ?? base?.subtype ?? def.id) as Subtype;
    const resolved: ResolvedTool = {
      id: def.id,
      subtype,
      preset: def.preset ?? def.id,
      propsKind: def.propsKind ?? base?.propsKind ?? subtype,
      cursor: def.cursor ?? base?.cursor ?? 'crosshair',
      enables: new Set(def.enables ?? (base ? [...base.enables] : [])),
      defaults: mergeDefaults(base?.defaults, def.defaults),
      source: def.source ?? base?.source,
      meta: base?.meta || def.meta ? { ...base?.meta, ...def.meta } : undefined,
    };
    out.set(id, resolved);
    return resolved;
  };
  for (const id of defs.keys()) resolve(id);
  return out;
}
