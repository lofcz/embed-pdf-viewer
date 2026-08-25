import type { ShellAction, ShellConfig, ShellState, SurfaceState } from './types';

export const emptyShellState: ShellState = {
  surfaces: {},
  openMenus: [],
};

/**
 * Seed document-scoped shell state. `defaultOpen` surfaces start open;
 * first-wins per exclusivity tag so two left-slot panels cannot both claim it.
 */
export function initialShellState(config: ShellConfig = {}): ShellState {
  const entries = config.defaultOpen;
  if (!entries || entries.length === 0) return emptyShellState;

  const surfaces: Record<string, SurfaceState> = {};
  const claimedExclusive = new Set<string>();

  for (const entry of entries) {
    if (entry.exclusive !== undefined && claimedExclusive.has(entry.exclusive)) continue;
    if (surfaces[entry.id]?.open) continue;
    if (entry.exclusive !== undefined) claimedExclusive.add(entry.exclusive);
    surfaces[entry.id] = { open: true, exclusive: entry.exclusive };
  }

  return { surfaces, openMenus: [] };
}

/** Close every open surface sharing the exclusivity tag. */
function closeExclusive(
  surfaces: Readonly<Record<string, SurfaceState>>,
  exclusive: string,
  except: string,
): Record<string, SurfaceState> {
  const next: Record<string, SurfaceState> = {};
  for (const [id, s] of Object.entries(surfaces)) {
    next[id] = s.open && s.exclusive === exclusive && id !== except ? { ...s, open: false } : s;
  }
  return next;
}

function openSurface(
  state: ShellState,
  id: string,
  exclusive?: string,
  props?: Readonly<Record<string, unknown>>,
): ShellState {
  const surfaces = exclusive
    ? closeExclusive(state.surfaces, exclusive, id)
    : { ...state.surfaces };
  surfaces[id] = { open: true, exclusive, props };
  return { ...state, surfaces };
}

function closeSurface(state: ShellState, id: string): ShellState {
  const existing = state.surfaces[id];
  if (!existing?.open) return state;
  return { ...state, surfaces: { ...state.surfaces, [id]: { ...existing, open: false } } };
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'SHELL/OPEN_SURFACE':
      return openSurface(state, action.id, action.exclusive, action.props);
    case 'SHELL/CLOSE_SURFACE':
      return closeSurface(state, action.id);
    case 'SHELL/TOGGLE_SURFACE':
      return state.surfaces[action.id]?.open
        ? closeSurface(state, action.id)
        : openSurface(state, action.id, action.exclusive, action.props);
    case 'SHELL/OPEN_MENU':
      return state.openMenus.includes(action.id)
        ? state
        : { ...state, openMenus: [...state.openMenus, action.id] };
    case 'SHELL/CLOSE_MENU':
      return state.openMenus.includes(action.id)
        ? { ...state, openMenus: state.openMenus.filter((m) => m !== action.id) }
        : state;
    case 'SHELL/CLOSE_ALL_MENUS':
      return state.openMenus.length === 0 ? state : { ...state, openMenus: [] };
    default:
      return state;
  }
}
