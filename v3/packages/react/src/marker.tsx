/**
 * Marker layer + menu — the React view of @embedpdf/plugin-marker.
 *
 * Demonstrates the full feature pattern: the layer reads page-space data via a
 * selector and maps pointer events through PageContext.toPagePoint; the menu is a
 * viewport-space overlay anchored via stage.toScreen and fully customizable via a
 * render prop. Note: no menu props are threaded through the layer — they're siblings.
 */
import * as React from 'react';
import { MarkerToken } from '@embedpdf/plugin-marker';
import type { Marker } from '@embedpdf/plugin-marker';
import { StageToken } from '@embedpdf/stage';
import { shallowArray, useCapability, usePage, useSelector } from './runtime';

export function useMarker() {
  return useCapability(MarkerToken);
}

export function MarkerLayer() {
  const page = usePage();
  const marker = useCapability(MarkerToken);
  const list = useSelector(MarkerToken, (c) => c.forPage(page.pageIndex), shallowArray);
  const selected = useSelector(MarkerToken, (c) => c.selectedId());
  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onDoubleClick={(e) => {
        const pt = page.toPagePoint(e.clientX, e.clientY);
        marker.add(page.pageIndex, pt);
      }}
    >
      {list.map((m) => (
        <div
          key={m.id}
          onClick={(e) => {
            e.stopPropagation();
            marker.select(m.id);
          }}
          title={`marker ${m.id}`}
          style={{
            position: 'absolute',
            left: m.x * page.scale - 7,
            top: m.y * page.scale - 7,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: selected === m.id ? '#ff3b30' : '#1e88e5',
            boxShadow: '0 0 0 2px #fff',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}

export interface MarkerMenuProps {
  children?: (args: { marker: Marker; remove: () => void }) => React.ReactNode;
}

export function MarkerMenu({ children }: MarkerMenuProps) {
  const stage = useCapability(StageToken);
  const marker = useCapability(MarkerToken);
  useSelector(StageToken, (c) => c.camera()); // reposition when the camera moves
  const sel = useSelector(MarkerToken, (c) => c.selectedMarker());
  if (!sel) return null;
  const pr = stage.pageRect(sel.page);
  if (!pr) return null;
  const s = stage.toScreen({ x: pr.x + sel.x, y: pr.y + sel.y });
  const remove = () => marker.remove(sel.id);
  return (
    <div
      style={{
        position: 'absolute',
        left: s.x,
        top: s.y - 44,
        transform: 'translateX(-50%)',
        pointerEvents: 'auto',
      }}
    >
      {children ? children({ marker: sel, remove }) : <button onClick={remove}>Delete</button>}
    </div>
  );
}
