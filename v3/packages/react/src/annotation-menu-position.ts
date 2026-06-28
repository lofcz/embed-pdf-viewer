import type { Rect } from '@embedpdf-x/geometry';

export type AnnotationMenuPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface AnnotationMenuPosition {
  left: number;
  top: number;
  transform: string;
}

export function positionMenuAroundRect(
  box: Rect,
  placement: AnnotationMenuPlacement,
  gap: number,
): AnnotationMenuPosition {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  switch (placement) {
    case 'bottom':
      return { left: cx, top: box.y + box.height + gap, transform: 'translate(-50%, 0)' };
    case 'left':
      return { left: box.x - gap, top: cy, transform: 'translate(-100%, -50%)' };
    case 'right':
      return { left: box.x + box.width + gap, top: cy, transform: 'translate(0, -50%)' };
    case 'top':
    default:
      return { left: cx, top: box.y - gap, transform: 'translate(-50%, -100%)' };
  }
}
