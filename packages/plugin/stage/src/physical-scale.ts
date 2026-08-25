/**
 * v2 zoom-plugin physical scaling — pure helpers.
 *
 * When `usePhysicalScaling` is on, numeric zoom values are USER-space and the
 * camera stores the EFFECTIVE scale: `user × (96/72) × devicePixelRatio`,
 * divided by `viewUnitsPerPoint` so v3's layout factor is not applied twice
 * (v3 already folds 96/72 into page world size by default).
 *
 * Fit modes stay in CSS-pixel space — they never go through these converters.
 */

/** 1 CSS inch = 96 px, 1 PDF point = 1/72 inch. */
export const PT_TO_CSS_PX = 96 / 72;

/**
 * Combined physical-scale multiplier: `(96/72) × devicePixelRatio` when the
 * flag is on, else 1. Mirrors v2 `ZoomPlugin.getDpr()`.
 */
export function physicalDpr(usePhysicalScaling: boolean, devicePixelRatio: number): number {
  if (!usePhysicalScaling) return 1;
  return PT_TO_CSS_PX * (devicePixelRatio || 1);
}

/**
 * User-space zoom → camera (effective) zoom. Identity when physical scaling
 * is off so existing `{ level }` callers keep working.
 */
export function userToCameraZoom(
  user: number,
  usePhysicalScaling: boolean,
  devicePixelRatio: number,
  viewUnitsPerPoint: number,
): number {
  if (!usePhysicalScaling) return user;
  const scale = physicalDpr(true, devicePixelRatio);
  return (user * scale) / (viewUnitsPerPoint || 1);
}

/**
 * Camera (effective) zoom → user-space. Gestures that captured the effective
 * scale MUST convert through this (or `÷ getDpr()`) before writing a `{ level }`
 * intent, or the next resolve would multiply the physical factor twice.
 */
export function cameraToUserZoom(
  cameraZoom: number,
  usePhysicalScaling: boolean,
  devicePixelRatio: number,
  viewUnitsPerPoint: number,
): number {
  if (!usePhysicalScaling) return cameraZoom;
  const scale = physicalDpr(true, devicePixelRatio);
  return (cameraZoom * (viewUnitsPerPoint || 1)) / scale;
}

/**
 * Wheel zoom factor: one signed `zoomStep` per event instead of raw
 * `deltaY * 0.01` (v2 `ZoomGestureOptions`, default step 0.1).
 */
export function wheelZoomFactor(deltaY: number, zoomStep = 0.1): number {
  return 1 - Math.sign(deltaY) * zoomStep;
}
