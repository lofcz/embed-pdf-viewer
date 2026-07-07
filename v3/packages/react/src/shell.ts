/**
 * The React surface for @embedpdf-x/plugin-shell. The app owns every
 * surface's DOM; these hooks bind its open/closed state to the kernel so
 * commands can drive it and persist can restore it.
 */
import { useMemo } from 'react';
import { ShellToken } from '@embedpdf-x/plugin-shell';
import type { OpenSurfaceOptions, ShellCapability } from '@embedpdf-x/plugin-shell';
import { useCapability, useSelector } from './runtime';

export function useShell(): ShellCapability {
  return useCapability(ShellToken);
}

export interface SurfaceHandle {
  readonly isOpen: boolean;
  readonly props: Readonly<Record<string, unknown>> | undefined;
  open(opts?: OpenSurfaceOptions): void;
  close(): void;
  toggle(opts?: OpenSurfaceOptions): void;
}

/** One named surface (panel / modal / overlay), bound to this subtree's document. */
export function useSurface(id: string): SurfaceHandle {
  const shell = useCapability(ShellToken);
  const isOpen = useSelector(ShellToken, (s) => s.isOpen(id));
  const props = useSelector(ShellToken, (s) => s.surfaceProps(id));
  return useMemo(
    () => ({
      isOpen,
      props,
      open: (opts?: OpenSurfaceOptions) => shell.open(id, opts),
      close: () => shell.close(id),
      toggle: (opts?: OpenSurfaceOptions) => shell.toggle(id, opts),
    }),
    [shell, id, isOpen, props],
  );
}

export interface MenusHandle {
  readonly open: readonly string[];
  isOpen(id: string): boolean;
  toggle(id: string): void;
  close(id: string): void;
  closeAll(): void;
}

const stringArrayEqual = (a: readonly string[], b: readonly string[]) =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

/** The dropdown-menu stack for this subtree's document. */
export function useMenus(): MenusHandle {
  const shell = useCapability(ShellToken);
  const open = useSelector(ShellToken, (s) => s.openMenus(), stringArrayEqual);
  return useMemo(
    () => ({
      open,
      isOpen: (id: string) => open.includes(id),
      toggle: (id: string) => shell.toggleMenu(id),
      close: (id: string) => shell.closeMenu(id),
      closeAll: () => shell.closeAllMenus(),
    }),
    [shell, open],
  );
}
