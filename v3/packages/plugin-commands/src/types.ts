import { createCapabilityToken } from '@embedpdf-x/kernel';
import type { CapabilityToken, CoreState } from '@embedpdf-x/kernel';
import type { KeyStroke } from '@embedpdf-x/ui-core';

/**
 * @embedpdf-x/plugin-commands — the contract.
 *
 * Commands are the single vocabulary of verbs: toolbars, menus, contextual
 * strips, shortcuts, and the palette are all projections of this registry.
 * The plugin ships ZERO commands (mechanism here, definitions in the product
 * — same split as plugin-i18n's locale packs).
 *
 * Command state is a pure DERIVATION over the store: `resolve()` reads other
 * capabilities' selectors at call time, so any store change is reflected on
 * the next read and the framework binding's one change stream makes every
 * consumer reactive. There is no CommandStateChangedEvent, no diffing, no
 * cache — v2's entire notification apparatus has no v3 equivalent because
 * the reactive store subsumes it.
 *
 * Definitions hold functions, so they live in the plugin's registry (config
 * + `register()`), never in the store; store state is only the serializable
 * `disabledCategories`.
 */

/** What a derivation or `run` sees: capability resolution bound to the
 *  command's target document (explicit, else the active one). */
export interface CommandCtx {
  /** The target document, or null when no document is open. */
  readonly documentId: string | null;
  core(): CoreState;
  /** Resolve a capability; document-scoped tokens bind to the target document. */
  get<T>(token: CapabilityToken<T>): T;
  /** Like `get`, but null when unavailable (no provider / no document). */
  tryGet<T>(token: CapabilityToken<T>): T | null;
}

export interface CommandDef {
  /** Convention: 'domain:verb' — 'zoom:in', 'mode:annotate', 'panel:search'. */
  readonly id: string;
  /** i18n key, resolved through I18nToken when present (else shown verbatim). */
  readonly labelKey: string;
  readonly icon?: string;
  /** 'Mod+K' style (ui-core grammar). Multiple bindings allowed. */
  readonly shortcut?: string | readonly string[];
  /** Feature-gating tags: a disabled category hides its commands everywhere. */
  readonly categories?: readonly string[];

  // ── declarative surface targets ──────────────────────────────────────────
  // A command that opens chrome DECLARES what it opens instead of doing it
  // imperatively. This is load-bearing: buttons render carets/aria-haspopup,
  // `active` derives automatically from the surface's open state, and the
  // overflow projection renders `menu` targets as nested submenus.
  /** Toggles a named dropdown menu (a MenuSchema id in the app's chrome). */
  readonly menu?: string;
  /** Toggles a named shell surface, optionally exclusive within a tag ('left'…). */
  readonly panel?: string | { readonly id: string; readonly exclusive?: string };
  /** Toggles a modal surface (exclusive within the built-in 'modal' tag). */
  readonly modal?: string;

  // ── pure derivations over the store ──────────────────────────────────────
  readonly enabled?: (ctx: CommandCtx) => boolean;
  readonly active?: (ctx: CommandCtx) => boolean;
  readonly visible?: (ctx: CommandCtx) => boolean;

  /** The verb. Optional for pure surface-target commands. Runs before the
   *  default target routing when both are present. */
  readonly run?: (ctx: CommandCtx) => void;
}

/** A command as a renderer sees it — everything resolved for the target document. */
export interface ResolvedCommand {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly shortcuts: readonly string[];
  readonly menu?: string;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly visible: boolean;
  readonly categories: readonly string[];
}

export interface CommandsState {
  readonly disabledCategories: readonly string[];
}

export type CommandsAction =
  | { type: 'COMMANDS/DISABLE_CATEGORY'; category: string }
  | { type: 'COMMANDS/ENABLE_CATEGORY'; category: string }
  | { type: 'COMMANDS/SET_DISABLED_CATEGORIES'; categories: readonly string[] };

export interface CommandsConfig {
  /** The app's command definitions (content — the plugin ships none). */
  commands?: readonly CommandDef[];
  /** Categories disabled at startup (host feature-gating). */
  disabledCategories?: readonly string[];
}

export interface CommandsCapability {
  // ── registry ──
  register(def: CommandDef): void;
  unregister(id: string): void;
  has(id: string): boolean;
  ids(): string[];

  // ── resolution (pure reads; reactive through the store) ──
  resolve(id: string, documentId?: string): ResolvedCommand | null;
  /** Palette query: visible commands whose resolved label matches. */
  search(query: string, documentId?: string): ResolvedCommand[];
  /** The one fact the overflow projection needs (ResolveMenuTarget-shaped). */
  menuTarget(id: string): { menu?: string } | null;

  // ── execution (the ONLY path; guarded by enabled/visible) ──
  execute(id: string, documentId?: string): void;
  /** Match a keystroke against every registered shortcut → command id or null. */
  matchStroke(stroke: KeyStroke, opts: { isMac: boolean }): string | null;

  // ── category gating ──
  disabledCategories(): readonly string[];
  isCategoryDisabled(category: string): boolean;
  disableCategory(category: string): void;
  enableCategory(category: string): void;
  setDisabledCategories(categories: readonly string[]): void;
}

export const CommandsToken = createCapabilityToken<CommandsCapability>('commands');
