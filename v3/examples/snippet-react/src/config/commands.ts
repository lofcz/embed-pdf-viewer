/**
 * The command vocabulary — the semantic layer. Ported in spirit from the v2
 * snippet's commands.ts, but every command is a pure value: label key, icon,
 * shortcut, derivations, and a `run` (or a declarative surface target). The
 * v2 `registry.getPlugin<T>(id)?.provides()` string-and-cast dance becomes a
 * typed `ctx.get(Token)`.
 *
 * Wiring reality (chrome-parity scope):
 *   zoom/pan/pointer/spread/scroll/rotate  → real Stage / Interaction / PageEdit
 *   modes                                  → shell exclusive surfaces ('mode')
 *   panels / menus / modals                → declarative shell targets
 *   annotate + shape tools                 → real interaction tools
 *   form/insert/redact tools               → inert interaction tools (demo-tools)
 *   history undo/redo                      → disabled (no history plugin in v3 yet)
 */
import type { CommandDef, IconAccent } from '@embedpdf-x/react/commands';
import { DocumentsToken } from '@embedpdf-x/react/runtime';
import { StageToken, ZoomMode } from '@embedpdf-x/react/stage';
import type { SpreadMode } from '@embedpdf-x/react/stage';
import { InteractionToken } from '@embedpdf-x/react/interaction';
import { PageEditToken } from '@embedpdf-x/react/page-edit';
import { ShellToken } from '@embedpdf-x/react/shell';
import { AnnotationToken } from '@embedpdf-x/react/annotation';
import type { PropSpec } from '@embedpdf-x/react/annotation';

// ── helpers ────────────────────────────────────────────────────────────────
type Ctx = Parameters<NonNullable<CommandDef['run']>>[0];

const stage = (c: Ctx) => c.tryGet(StageToken);
const interaction = (c: Ctx) => c.tryGet(InteractionToken);
const anno = (c: Ctx) => c.tryGet(AnnotationToken);

// ── annotation-selection predicates (drive the floating strip's contents) ────
const hasAnnotationSelection = (c: Ctx) => (anno(c)?.selection().length ?? 0) > 0;
/** v2 gated strip items per subtype (comment hidden on links/widgets) — here
 *  it's one derivation over the selected DTOs instead of per-command lookups. */
const selectionSubtypes = (c: Ctx) => new Set((anno(c)?.getSelected() ?? []).map((a) => a.subtype));

// ── tool icon accents: THIS viewer's design decision ─────────────────────────
// A tool icon previews its drawing defaults: primary = the kind's FIRST color
// prop, secondary = its SECOND — the same order the style panel renders them
// (shapes: stroke + fill; markup: the mark; free text: the font color). The
// plugins only state facts (propsForTool = schema, currentDefaults = values);
// which colors tint a glyph is decided here, and another viewer may decide
// differently.
const COLOR_KEYS = ['color', 'interiorColor', 'fontColor'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
const isColorSpec = (s: PropSpec): s is PropSpec & { key: ColorKey } =>
  (COLOR_KEYS as readonly string[]).includes(s.key);

const toolAccent = (c: Ctx, toolId: string): IconAccent | null => {
  const anno = c.tryGet(AnnotationToken);
  if (!anno) return null;
  const colors = anno.propsForTool(toolId).filter(isColorSpec);
  const d = anno.currentDefaults(toolId);
  return {
    primary: colors[0] ? (d[colors[0].key] ?? undefined) : undefined,
    secondary: colors[1] ? (d[colors[1].key] ?? undefined) : undefined,
  };
};

/** A tool command: activates a real interaction tool; active = it's the tool.
 *  The icon previews the tool's current defaults — keyed by the SAME toolId
 *  as run/active, so the accent can't drift to another tool's colors. */
const tool = (id: string, toolId: string, labelKey: string, icon: string): CommandDef => ({
  id,
  labelKey,
  icon,
  categories: ['tool'],
  run: (c) => interaction(c)?.activateTool(toolId),
  active: (c) => interaction(c)?.activeToolId() === toolId,
  enabled: (c) => interaction(c) != null,
  iconAccent: (c) => toolAccent(c, toolId),
});

/** A fixed zoom level (fraction), e.g. 1 = 100%. */
const zoomLevel = (id: string, level: number, label: string): CommandDef => ({
  id,
  labelKey: label,
  categories: ['zoom', 'zoom-level'],
  run: (c) => stage(c)?.zoomTo({ level }),
  enabled: (c) => stage(c) != null,
});

const spread = (id: string, mode: SpreadMode, labelKey: string, icon: string): CommandDef => ({
  id,
  labelKey,
  icon,
  categories: ['page', 'spread'],
  run: (c) => stage(c)?.setSpread(mode),
  active: (c) => stage(c)?.spread() === mode,
  enabled: (c) => stage(c) != null,
});

export const commands: CommandDef[] = [
  // ── zoom ───────────────────────────────────────────────────────────────
  {
    id: 'zoom:in',
    labelKey: 'commands.zoom.in',
    icon: 'zoomIn',
    shortcut: ['Mod+=', 'Mod+NumpadAdd'],
    categories: ['zoom'],
    run: (c) => stage(c)?.zoomIn(),
    enabled: (c) => stage(c) != null,
  },
  {
    id: 'zoom:out',
    labelKey: 'commands.zoom.out',
    icon: 'zoomOut',
    shortcut: ['Mod+-', 'Mod+NumpadSubtract'],
    categories: ['zoom'],
    run: (c) => stage(c)?.zoomOut(),
    enabled: (c) => stage(c) != null,
  },
  {
    id: 'zoom:fit-page',
    labelKey: 'commands.zoom.fitPage',
    icon: 'fitToPage',
    shortcut: 'Mod+0',
    categories: ['zoom'],
    run: (c) => stage(c)?.fitPage(),
    active: (c) => stage(c)?.zoomMode() === ZoomMode.FitPage,
    enabled: (c) => stage(c) != null,
  },
  {
    id: 'zoom:fit-width',
    labelKey: 'commands.zoom.fitWidth',
    icon: 'fitToWidth',
    shortcut: 'Mod+1',
    categories: ['zoom'],
    run: (c) => stage(c)?.fitWidth(),
    active: (c) => stage(c)?.zoomMode() === ZoomMode.FitWidth,
    enabled: (c) => stage(c) != null,
  },
  {
    id: 'zoom:automatic',
    labelKey: 'commands.zoom.automatic',
    categories: ['zoom'],
    run: (c) => stage(c)?.automatic(),
    active: (c) => stage(c)?.zoomMode() === ZoomMode.Automatic,
    enabled: (c) => stage(c) != null,
  },
  zoomLevel('zoom:50', 0.5, 'commands.zoom.p50'),
  zoomLevel('zoom:100', 1, 'commands.zoom.p100'),
  zoomLevel('zoom:150', 1.5, 'commands.zoom.p150'),
  zoomLevel('zoom:200', 2, 'commands.zoom.p200'),
  zoomLevel('zoom:400', 4, 'commands.zoom.p400'),
  {
    id: 'zoom:menu',
    labelKey: 'commands.zoom.menu',
    icon: 'zoomIn',
    categories: ['zoom'],
    menu: 'zoom',
  },

  // ── tools ──────────────────────────────────────────────────────────────
  {
    id: 'pan:toggle',
    labelKey: 'commands.pan',
    icon: 'hand',
    categories: ['tools'],
    run: (c) => interaction(c)?.activateTool('pan'),
    active: (c) => interaction(c)?.activeToolId() === 'pan',
    enabled: (c) => interaction(c) != null,
  },
  {
    id: 'pointer:toggle',
    labelKey: 'commands.pointer',
    icon: 'pointer',
    categories: ['tools'],
    run: (c) => interaction(c)?.activateTool('pointer'),
    active: (c) => interaction(c)?.activeToolId() === 'pointer',
    enabled: (c) => interaction(c) != null,
  },

  // ── panels (declarative shell targets) ──────────────────────────────────
  {
    id: 'panel:sidebar',
    labelKey: 'commands.sidebar',
    icon: 'sidebar',
    categories: ['panel'],
    panel: { id: 'sidebar', exclusive: 'left' },
  },
  {
    id: 'panel:search',
    labelKey: 'commands.search',
    icon: 'search',
    categories: ['panel'],
    panel: { id: 'search', exclusive: 'right' },
  },
  {
    id: 'panel:comment',
    labelKey: 'commands.comment',
    icon: 'comment',
    categories: ['panel'],
    panel: { id: 'comment', exclusive: 'right' },
  },
  {
    id: 'panel:annotation-style',
    labelKey: 'commands.style',
    icon: 'palette',
    categories: ['panel'],
    panel: { id: 'annotation-style', exclusive: 'right' },
  },

  // ── menus (declarative) ─────────────────────────────────────────────────
  {
    id: 'document:menu',
    labelKey: 'commands.menu',
    icon: 'menu',
    categories: ['document'],
    menu: 'document',
  },
  {
    id: 'page:settings',
    labelKey: 'commands.viewControls',
    icon: 'viewSettings',
    categories: ['page'],
    menu: 'page-settings',
  },

  // ── document actions ────────────────────────────────────────────────────
  {
    id: 'document:download',
    labelKey: 'commands.download',
    icon: 'download',
    categories: ['document'],
    run: (c) => {
      const id = c.documentId ?? undefined;
      c.tryGet(DocumentsToken)
        ?.download(id)
        .then((bytes) => {
          const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'document.pdf';
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch((e) => console.warn('[snippet-react] download failed', e));
    },
    enabled: (c) => c.tryGet(DocumentsToken) != null && c.documentId != null,
  },
  {
    id: 'document:print',
    labelKey: 'commands.print',
    icon: 'print',
    shortcut: 'Mod+p',
    categories: ['document'],
    run: () => window.print(),
  },
  {
    id: 'document:fullscreen',
    labelKey: 'commands.fullscreen',
    icon: 'externalLink',
    categories: ['document'],
    run: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    },
    active: () => Boolean(document.fullscreenElement),
  },

  // ── page settings (spread / scroll / rotate) ────────────────────────────
  spread('spread:none', 'none', 'commands.spread.none', 'singlePage'),
  spread('spread:odd', 'odd', 'commands.spread.odd', 'doublePage'),
  spread('spread:even', 'even', 'commands.spread.even', 'book2'),
  {
    id: 'scroll:vertical',
    labelKey: 'commands.scroll.vertical',
    icon: 'vertical',
    categories: ['page', 'scroll'],
    run: (c) => stage(c)?.setLayout('vertical'),
    active: (c) => stage(c)?.layout() === 'vertical',
    enabled: (c) => stage(c) != null,
  },
  {
    id: 'scroll:horizontal',
    labelKey: 'commands.scroll.horizontal',
    icon: 'horizontal',
    categories: ['page', 'scroll'],
    run: (c) => stage(c)?.setLayout('horizontal'),
    active: (c) => stage(c)?.layout() === 'horizontal',
    enabled: (c) => stage(c) != null,
  },
  {
    id: 'rotate:clockwise',
    labelKey: 'commands.rotate.clockwise',
    icon: 'rotateClockwise',
    categories: ['page', 'rotate'],
    run: (c) => {
      const s = stage(c);
      const edit = c.tryGet(PageEditToken);
      if (!s || !edit) return;
      const pages = s.pages();
      const current = pages[Math.max(0, s.currentPage() - 1)] ?? pages[0];
      if (current) edit.rotateBy(current.pon, 90);
    },
    enabled: (c) => c.tryGet(PageEditToken) != null,
  },
  {
    id: 'rotate:counter-clockwise',
    labelKey: 'commands.rotate.counterclockwise',
    icon: 'rotateCounterClockwise',
    categories: ['page', 'rotate'],
    run: (c) => {
      const s = stage(c);
      const edit = c.tryGet(PageEditToken);
      if (!s || !edit) return;
      const pages = s.pages();
      const current = pages[Math.max(0, s.currentPage() - 1)] ?? pages[0];
      if (current) edit.rotateBy(current.pon, -90);
    },
    enabled: (c) => c.tryGet(PageEditToken) != null,
  },

  // ── modes (shell exclusive surfaces, tag 'mode') ────────────────────────
  {
    id: 'mode:view',
    labelKey: 'commands.mode.view',
    categories: ['mode'],
    // View = no mode band. Close any open mode surface and drop to pointer.
    run: (c) => {
      const shell = c.tryGet(ShellToken);
      for (const m of MODE_SURFACES) shell?.close(m);
      interaction(c)?.activateTool('pointer');
    },
    active: (c) => {
      const shell = c.tryGet(ShellToken);
      return shell ? MODE_SURFACES.every((m) => !shell.isOpen(m)) : true;
    },
  },
  modeCommand('mode:annotate', 'commands.mode.annotate'),
  modeCommand('mode:shapes', 'commands.mode.shapes'),
  modeCommand('mode:insert', 'commands.mode.insert'),
  modeCommand('mode:form', 'commands.mode.form'),
  modeCommand('mode:redact', 'commands.mode.redact'),

  // ── annotate tools (real interaction tools) ─────────────────────────────
  tool('annotation:add-highlight', 'highlight', 'commands.annotate.highlight', 'highlight'),
  tool('annotation:add-strikeout', 'strikeout', 'commands.annotate.strikeout', 'strikethrough'),
  tool('annotation:add-underline', 'underline', 'commands.annotate.underline', 'underline'),
  tool('annotation:add-squiggly', 'squiggly', 'commands.annotate.squiggly', 'squiggly'),
  tool('annotation:add-ink', 'ink', 'commands.annotate.ink', 'pencilMarker'),
  tool('annotation:add-text', 'free-text', 'commands.annotate.text', 'freeText'),
  tool('annotation:add-insert-text', 'insert-text', 'commands.annotate.insertText', 'insertText'),
  tool('annotation:add-callout', 'free-text-callout', 'commands.annotate.callout', 'callout'),

  // ── shape tools (real interaction tools) ────────────────────────────────
  tool('annotation:add-rectangle', 'square', 'commands.shapes.rectangle', 'square'),
  tool('annotation:add-circle', 'circle', 'commands.shapes.circle', 'circle'),
  tool('annotation:add-line', 'line', 'commands.shapes.line', 'line'),
  tool('annotation:add-polygon', 'polygon', 'commands.shapes.polygon', 'polygon'),
  tool('annotation:add-polyline', 'polyline', 'commands.shapes.polyline', 'zigzag'),

  // ── insert tools (stamp real; signature/image inert) ────────────────────
  tool('insert:add-stamp', 'stamp', 'commands.insert.stamp', 'rubberStamp'),
  tool('insert:add-signature', 'signature', 'commands.insert.signature', 'signature'),
  tool('insert:add-image', 'image', 'commands.insert.image', 'photo'),

  // ── form tools (inert) ──────────────────────────────────────────────────
  tool('form:add-textfield', 'form-textfield', 'commands.form.textfield', 'formTextfield'),
  tool('form:add-checkbox', 'form-checkbox', 'commands.form.checkbox', 'formCheckbox'),
  tool('form:add-radio', 'form-radio', 'commands.form.radio', 'formRadio'),
  tool('form:add-select', 'form-select', 'commands.form.select', 'formSelect'),
  tool('form:add-listbox', 'form-listbox', 'commands.form.listbox', 'formListbox'),

  // ── redact tools (inert) ────────────────────────────────────────────────
  tool('redaction:redact', 'redact', 'commands.redact.mark', 'redact'),

  // ── annotation selection (the floating strip's verbs) ──────────────────
  {
    id: 'annotation:delete',
    labelKey: 'commands.annotate.delete',
    icon: 'trash',
    categories: ['annotation'],
    run: (c) => anno(c)?.deleteSelection(),
    visible: hasAnnotationSelection,
    // Mirrors the engine's own authorization: locked/unauthorized annotations
    // keep the button visible but disabled (the engine still enforces).
    enabled: (c) => {
      const a = anno(c);
      const refs = a?.getSelection() ?? [];
      return refs.length > 0 && refs.every((r) => a!.canDelete(r));
    },
  },
  {
    id: 'annotation:comment',
    labelKey: 'commands.comment',
    icon: 'comment',
    categories: ['annotation'],
    // Same 'comment' surface panel:comment toggles — `active` derives from it.
    panel: { id: 'comment', exclusive: 'right' },
    visible: (c) => hasAnnotationSelection(c) && !selectionSubtypes(c).has('widget'),
  },
  {
    id: 'annotation:style',
    labelKey: 'commands.style',
    icon: 'palette',
    categories: ['annotation'],
    panel: { id: 'annotation-style', exclusive: 'right' },
    // The kind table decides: no declared editable props → no style button
    // (v2 hardcoded a subtype blocklist for this).
    visible: (c) => (anno(c)?.getSelectionProps().specs.length ?? 0) > 0,
  },
  {
    id: 'annotation:group',
    labelKey: 'commands.annotate.group',
    icon: 'group',
    categories: ['annotation'],
    run: (c) => void anno(c)?.group(),
    visible: (c) => anno(c)?.canGroup() ?? false,
  },
  {
    id: 'annotation:ungroup',
    labelKey: 'commands.annotate.ungroup',
    icon: 'ungroup',
    categories: ['annotation'],
    run: (c) => void anno(c)?.ungroup(),
    visible: (c) => anno(c)?.canUngroup() ?? false,
  },

  // ── history (no plugin yet → disabled, shows the disabled styling) ──────
  {
    id: 'history:undo',
    labelKey: 'commands.undo',
    icon: 'arrowBackUp',
    categories: ['history'],
    run: () => {},
    enabled: () => false,
  },
  {
    id: 'history:redo',
    labelKey: 'commands.redo',
    icon: 'arrowForwardUp',
    categories: ['history'],
    run: () => {},
    enabled: () => false,
  },
];

// ── mode helpers ─────────────────────────────────────────────────────────────
// Modes are exclusive shell surfaces tagged 'mode'; the secondary band renders
// whichever one is open. Kept below the array to keep the list readable.
export const MODE_SURFACES = [
  'mode:annotate',
  'mode:shapes',
  'mode:insert',
  'mode:form',
  'mode:redact',
] as const;

function modeCommand(id: (typeof MODE_SURFACES)[number], labelKey: string): CommandDef {
  return {
    id,
    labelKey,
    categories: ['mode'],
    panel: { id, exclusive: 'mode' },
  };
}
