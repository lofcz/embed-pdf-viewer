/**
 * The app's toolbar look — Tailwind render props over the headless <Toolbar>.
 * The app owns the pixels; ui-core owns the physics (measure → solve →
 * overflow). Nothing here knows about breakpoints or widths.
 */
import { useState } from 'react';
import {
  Toolbar,
  useCommand,
  useCommands,
  useMenus,
  useT,
  useOptionalSelector,
} from '@embedpdf-x/react';
import type { CollapsedGroupView, OverflowMenuView } from '@embedpdf-x/react';
import type { ResolvedCommand } from '@embedpdf-x/plugin-commands';
import type { BarSchema } from '@embedpdf-x/ui-core';
import { StageToken } from '@embedpdf-x/plugin-stage';
import { Icon } from './icons';
import { MenuBody, Popover, InlineSubmenu } from './menu';

const BTN =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-2 text-fg-secondary transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40';
const BTN_ACTIVE = 'bg-accent-light text-accent hover:bg-accent-light';

// ── a single command button (icon / icon+label / label=tab) ──────────────────
function CommandButton({
  cmd,
  variant,
  run,
}: {
  cmd: ResolvedCommand;
  variant: string;
  run: () => void;
}) {
  const isTab = variant === 'label';
  const showLabel = variant === 'label' || variant === 'icon+label';
  const showIcon = variant !== 'label' && Boolean(cmd.icon);

  const className = isTab
    ? `inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors ${
        cmd.active ? 'bg-accent-light text-accent' : 'text-fg-secondary hover:bg-hover'
      }`
    : `${BTN} ${cmd.active ? BTN_ACTIVE : ''} ${showLabel ? 'text-sm' : 'w-9'}`;

  const button = (
    <button
      type="button"
      onClick={run}
      disabled={!cmd.enabled}
      aria-pressed={cmd.active || undefined}
      aria-haspopup={cmd.menu ? 'menu' : undefined}
      title={cmd.label}
      className={className}
    >
      {showIcon && <Icon name={cmd.icon!} size={20} />}
      {showLabel && <span className="truncate">{cmd.label}</span>}
      {cmd.menu && <Icon name="chevronDown" size={14} />}
    </button>
  );

  // A menu command anchors its dropdown to itself; it's open iff the shell
  // menu is open (which is what `active` reflects for menu commands).
  if (!cmd.menu) return button;
  return <MenuAnchoredButton cmd={cmd}>{button}</MenuAnchoredButton>;
}

function MenuAnchoredButton({
  cmd,
  children,
}: {
  cmd: ResolvedCommand;
  children: React.ReactNode;
}) {
  const menus = useMenus();
  const open = cmd.menu ? menus.isOpen(cmd.menu) : false;
  return (
    <span className="relative inline-flex">
      {children}
      {open && cmd.menu && (
        <Popover onClose={() => menus.close(cmd.menu!)}>
          <MenuBody menuId={cmd.menu} onRun={() => menus.close(cmd.menu!)} />
        </Popover>
      )}
    </span>
  );
}

// ── the inline zoom widget (the 'zoom-controls' custom slot) ─────────────────
function ZoomControls() {
  const commands = useCommands();
  const menus = useMenus();
  // Null-safe: the zoom strip is main-toolbar chrome, mounted before any
  // document exists — it reads 100% until a Stage is there to ask.
  const level = useOptionalSelector(StageToken, (c) => c.zoomLevel(), 1);
  const pct = Math.round((level ?? 1) * 100);
  const open = menus.isOpen('zoom');
  return (
    <div className="border-border-subtle relative inline-flex h-9 items-center rounded-md border">
      <button
        type="button"
        title="Zoom out"
        className={`${BTN} w-8 rounded-r-none`}
        onClick={() => commands.execute('zoom:out')}
      >
        <Icon name="zoomOut" size={18} />
      </button>
      <button
        type="button"
        className="text-fg-secondary hover:bg-hover flex h-9 min-w-14 items-center justify-center gap-1 px-1 text-sm tabular-nums"
        onClick={() => menus.toggle('zoom')}
      >
        {pct}%
        <Icon name="chevronDown" size={14} />
      </button>
      <button
        type="button"
        title="Zoom in"
        className={`${BTN} w-8 rounded-l-none`}
        onClick={() => commands.execute('zoom:in')}
      >
        <Icon name="zoomIn" size={18} />
      </button>
      {open && (
        <Popover onClose={() => menus.close('zoom')}>
          <MenuBody menuId="zoom" onRun={() => menus.close('zoom')} />
        </Popover>
      )}
    </div>
  );
}

/** The 'button' variant of the zoom slot — a single icon that opens the menu. */
function ZoomButton() {
  const menus = useMenus();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title="Zoom"
        className={`${BTN} w-9`}
        onClick={() => menus.toggle('zoom')}
      >
        <Icon name="zoomIn" size={20} />
      </button>
      {menus.isOpen('zoom') && (
        <Popover onClose={() => menus.close('zoom')}>
          <MenuBody menuId="zoom" onRun={() => menus.close('zoom')} />
        </Popover>
      )}
    </span>
  );
}

// ── the collapsed modes group (v2's mode-select-button, derived) ─────────────
function CollapsedModes({ view }: { view: CollapsedGroupView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const active = view.commands.find((c) => c.active) ?? view.commands[0];
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${BTN} text-sm`}
        aria-haspopup="menu"
      >
        <span className="truncate">{active?.label ?? t(view.labelKey ?? '')}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)}>
          <div className="min-w-44 p-1">
            {view.commands.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  view.execute(c.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                  c.active ? 'bg-accent-light text-accent' : 'text-fg-secondary hover:bg-hover'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}

// ── the derived overflow menu ────────────────────────────────────────────────
function OverflowMenu({ view }: { view: OverflowMenuView }) {
  const t = useT();
  if (!view.isOpen) return null;
  return (
    <Popover onClose={view.close} align="end">
      <div className="min-w-56 p-1">
        {view.sections.map((section, i) => (
          <div key={i}>
            {i > 0 && <div className="bg-border-subtle my-1 h-px" />}
            {section.labelKey && (
              <div className="text-fg-muted px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide">
                {t(section.labelKey)}
              </div>
            )}
            {section.rows.map((row) => {
              const cmd = view.resolve(row.command);
              if (!cmd) return null;
              if (row.type === 'submenu') {
                return <InlineSubmenu key={row.command} menuId={row.menu} label={cmd.label} />;
              }
              return (
                <button
                  key={row.command}
                  type="button"
                  role={section.role === 'radio' ? 'menuitemradio' : 'menuitem'}
                  aria-checked={section.role === 'radio' ? cmd.active : undefined}
                  disabled={!cmd.enabled}
                  onClick={() => {
                    view.execute(row.command);
                    view.close();
                  }}
                  className={`hover:bg-hover flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-40 ${
                    cmd.active ? 'text-accent' : 'text-fg-secondary'
                  }`}
                >
                  <span className="text-fg-muted flex w-4 justify-center">
                    {cmd.active && section.role === 'radio' ? (
                      <Icon name="check" size={16} />
                    ) : cmd.icon ? (
                      <Icon name={cmd.icon} size={16} />
                    ) : null}
                  </span>
                  <span className="flex-1 truncate">{cmd.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Popover>
  );
}

function OverflowTrigger({ isOpen, toggle }: { isOpen: boolean; toggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      title={t('demo.more')}
      className={`${BTN} w-9 ${isOpen ? BTN_ACTIVE : ''}`}
    >
      <Icon name="dots" size={20} />
    </button>
  );
}

// ── the assembled toolbar ────────────────────────────────────────────────────
export function AppToolbar({ bar, className }: { bar: BarSchema; className?: string }) {
  return (
    <Toolbar
      bar={bar}
      gap={6}
      className={className}
      renderCommand={(cmd, variant, run) => <CommandButton cmd={cmd} variant={variant} run={run} />}
      renderCustom={{
        'zoom-controls': (variant) => (variant === 'inline' ? <ZoomControls /> : <ZoomButton />),
      }}
      renderCollapsed={(view) => (view.id === 'modes' ? <CollapsedModes view={view} /> : undefined)}
      renderSeparator={() => <span className="bg-border-subtle mx-0.5 h-6 w-px self-center" />}
      renderOverflowTrigger={(isOpen, toggle) => (
        <OverflowTrigger isOpen={isOpen} toggle={toggle} />
      )}
      renderOverflowMenu={(view) => <OverflowMenu view={view} />}
    />
  );
}
