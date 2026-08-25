import { definePlugin } from '@embedpdf/core';
import { createShellCapability } from './capability';
import { initialShellState, shellReducer } from './reducer';
import { ShellToken } from './types';
import type { ShellAction, ShellCapability, ShellConfig, ShellState } from './types';

/**
 * The shell plugin: document-scoped (each document keeps its own panels, so
 * switching tabs restores them). Pure state, no effects — the app renders
 * surfaces; commands toggle them.
 *
 * `defaultOpen` seeds surfaces that should start open on a new document
 * (v2 `SidebarSchema.defaultOpen` — first-wins per exclusivity tag).
 */
export const shellPlugin = (config: ShellConfig = {}) =>
  definePlugin<ShellState, ShellAction, ShellCapability>({
    id: 'shell',
    scope: 'document',
    token: ShellToken,
    initialState: () => initialShellState(config),
    reduce: shellReducer,
    capability: createShellCapability,
  });
