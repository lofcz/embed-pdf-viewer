/**
 * Custom smooth-scroll animator for the PDF viewport.
 *
 * Native `element.scrollTo({ behavior: 'smooth' })` animates the full scroll
 * distance with a roughly time-proportional interpolation, so jumping across
 * many pages produces a long, sluggish glide during which the virtualized
 * content cannot keep up (the scrollbar races ahead of blank/unrendered pages).
 *
 * This animator replaces native smooth scrolling with a `requestAnimationFrame`
 * driven animation that:
 *  - caps the duration (~fast) regardless of distance, so long jumps feel as
 *    snappy as short ones,
 *  - uses an ease-out curve so the motion decelerates into the target,
 *  - is cancelled immediately by user wheel/touch input or a newer scroll request.
 */

export interface SmoothScrollTarget {
  left: number;
  top: number;
}

export interface SmoothScrollOptions {
  /**
   * Duration in ms. When omitted, a distance-aware duration is used so short
   * scrolls stay quick and long scrolls never exceed `maxDuration`.
   */
  duration?: number;
  /** Called on every animation frame with the current scroll position. */
  onUpdate?: (left: number, top: number) => void;
  /** Called when the animation completes naturally (not when cancelled). */
  onComplete?: () => void;
  /** Called when the animation is cancelled (user input or superseded). */
  onCancel?: () => void;
}

export interface SmoothScrollHandle {
  /** Cancel the animation (does not fire onComplete). */
  cancel: () => void;
  /** Whether the animation is currently running. */
  isRunning: () => boolean;
}

const MIN_DURATION = 160;
const MAX_DURATION = 420;
// Pixels of scroll distance that maps onto the [MIN, MAX] duration range.
const DISTANCE_FOR_MAX_DURATION = 2400;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// Ease-out cubic: fast start, gentle settle into the target.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate `el`'s scroll position towards the target. Returns a handle that can
 * cancel the animation. The animation is also cancelled by user wheel/touch
 * input on the element.
 */
export function smoothScrollTo(
  el: HTMLElement,
  target: SmoothScrollTarget,
  options: SmoothScrollOptions = {},
): SmoothScrollHandle {
  const { onUpdate, onComplete, onCancel } = options;

  const startLeft = el.scrollLeft;
  const startTop = el.scrollTop;
  const deltaLeft = target.left - startLeft;
  const deltaTop = target.top - startTop;
  const distance = Math.hypot(deltaLeft, deltaTop);

  // Nothing to do — snap and report completion.
  if (distance < 1) {
    el.scrollLeft = target.left;
    el.scrollTop = target.top;
    onUpdate?.(target.left, target.top);
    onComplete?.();
    return { cancel: () => {}, isRunning: () => false };
  }

  const duration =
    options.duration ??
    clamp(
      MIN_DURATION + (distance / DISTANCE_FOR_MAX_DURATION) * (MAX_DURATION - MIN_DURATION),
      MIN_DURATION,
      MAX_DURATION,
    );

  let rafId = 0;
  let startTime: number | null = null;
  let running = true;
  let finished = false;

  const cleanupListeners = () => {
    el.removeEventListener('wheel', onUserInterrupt, true);
    el.removeEventListener('touchstart', onUserInterrupt, true);
    el.removeEventListener('pointerdown', onUserInterrupt, true);
  };

  const finish = (completed: boolean) => {
    if (finished) return;
    finished = true;
    running = false;
    cancelAnimationFrame(rafId);
    cleanupListeners();
    if (completed) {
      onComplete?.();
    } else {
      onCancel?.();
    }
  };

  // Cancel on any user-driven scroll intent so the user always wins.
  const onUserInterrupt = () => finish(false);

  const step = (now: number) => {
    if (!running) return;
    if (startTime === null) startTime = now;
    const elapsed = now - startTime;
    const t = clamp(elapsed / duration, 0, 1);
    const eased = easeOutCubic(t);

    const left = startLeft + deltaLeft * eased;
    const top = startTop + deltaTop * eased;
    el.scrollLeft = left;
    el.scrollTop = top;
    onUpdate?.(left, top);

    if (t >= 1) {
      // Snap to the exact target to avoid sub-pixel drift.
      el.scrollLeft = target.left;
      el.scrollTop = target.top;
      finish(true);
      return;
    }
    rafId = requestAnimationFrame(step);
  };

  el.addEventListener('wheel', onUserInterrupt, { capture: true, passive: true });
  el.addEventListener('touchstart', onUserInterrupt, { capture: true, passive: true });
  el.addEventListener('pointerdown', onUserInterrupt, { capture: true, passive: true });

  rafId = requestAnimationFrame(step);

  return {
    cancel: () => finish(false),
    isRunning: () => running,
  };
}
