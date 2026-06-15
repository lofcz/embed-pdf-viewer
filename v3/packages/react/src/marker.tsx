/**
 * Marker layer + menu — the React view of @embedpdf-x/plugin-marker.
 *
 * Demonstrates the full feature pattern: the layer reads page-space data via a
 * selector and maps pointer events through PageContext.toPagePoint; the menu is a
 * viewport-space overlay anchored by composing stage.pageToWorld with stage.toScreen,
 * fully customizable via a render prop. Note: no menu props are threaded through
 * the layer — they're siblings.
 */
import * as React from 'react';
import { MarkerToken } from '@embedpdf-x/plugin-marker';
import type { Marker } from '@embedpdf-x/plugin-marker';
import { StageToken } from '@embedpdf-x/plugin-stage';
import { shallowArray, useCapability, usePage, useSelector } from './runtime';

export function useMarker() {
  return useCapability(MarkerToken);
}

export function MarkerLayer() {
  const page = usePage();
  const marker = useCapability(MarkerToken);
  const list = useSelector(MarkerToken, (c) => c.forPage(page.pon), shallowArray);
  const selected = useSelector(MarkerToken, (c) => c.selectedId());
  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onDoubleClick={(e) => {
        const pt = page.toPagePoint(e.clientX, e.clientY);
        marker.add(page.pon, pt);
      }}
    >
      {list.map((m) => {
        // content-space px — this layer rides the page's CSS rotation, so place in
        // un-rotated content coordinates (no rotation applied here).
        const v = page.transform.pageToContent({ x: m.x, y: m.y });
        return (
          <div
            key={m.id}
            onClick={(e) => {
              e.stopPropagation();
              marker.select(m.id);
            }}
            title={`marker ${m.id}`}
            style={{
              position: 'absolute',
              left: v.x - 7,
              top: v.y - 7,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: selected === m.id ? '#ff3b30' : '#1e88e5',
              boxShadow: '0 0 0 2px #fff',
              cursor: 'pointer',
            }}
          />
        );
      })}
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
  // markers live in page space; pageToWorld applies the sizing policy's
  // contentScale, toScreen applies the camera — never compose these by hand
  const w = stage.pageToWorld(sel.pon, sel);
  if (!w) return null;
  const s = stage.toScreen(w);
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
