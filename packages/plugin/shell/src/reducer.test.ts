import { describe, expect, it } from 'vitest';
import { emptyShellState, initialShellState, shellReducer } from './reducer';

describe('initialShellState defaultOpen', () => {
  it('starts empty when nothing opts in', () => {
    expect(initialShellState()).toEqual(emptyShellState);
    expect(initialShellState({})).toEqual(emptyShellState);
  });

  it('opens matching surfaces on first document state', () => {
    const state = initialShellState({
      defaultOpen: [{ id: 'sidebar', exclusive: 'left' }],
    });
    expect(state.surfaces.sidebar).toEqual({ open: true, exclusive: 'left' });
    expect(state.openMenus).toEqual([]);
  });

  it('first-wins a contested exclusivity slot', () => {
    const state = initialShellState({
      defaultOpen: [
        { id: 'sidebar', exclusive: 'left' },
        { id: 'annotation-panel', exclusive: 'left' },
        { id: 'search', exclusive: 'right' },
      ],
    });
    expect(state.surfaces.sidebar?.open).toBe(true);
    expect(state.surfaces['annotation-panel']).toBeUndefined();
    expect(state.surfaces.search).toEqual({ open: true, exclusive: 'right' });
  });
});

describe('shellReducer', () => {
  it('keeps a default-open surface closable', () => {
    const open = initialShellState({ defaultOpen: [{ id: 'sidebar', exclusive: 'left' }] });
    const closed = shellReducer(open, { type: 'SHELL/CLOSE_SURFACE', id: 'sidebar' });
    expect(closed.surfaces.sidebar?.open).toBe(false);
  });
});
