import type { EffectContext } from '@embedpdf/kernel';
import { StageToken, type StageViewState } from '@embedpdf/stage';
import type { PersistConfig } from './types';

/**
 * The whole plugin: react to the Stage's view-state and mirror it to storage.
 * (In a real build, `localStorage` would be an injected storage port so this stays
 * platform-agnostic — but the shape is identical.)
 */
export function registerPersistEffects(ctx: EffectContext<unknown>, config: PersistConfig): void {
  const stage = ctx.get(StageToken); // typed via the token — no cast, no string
  const storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null;
  if (!storage) return;

  const saved = storage.getItem(config.key);
  let restored = false;

  // Restore exactly once, when the viewport first has a real size.
  ctx.watch(
    () => stage.viewport().width,
    (w) => {
      if (restored || w <= 0) return;
      restored = true;
      if (saved) {
        try {
          stage.applyViewState(JSON.parse(saved) as StageViewState);
        } catch {
          /* ignore corrupt persisted state */
        }
      }
    },
  );

  // Persist on change — debounced, serialized so the comparison is stable.
  let timer: ReturnType<typeof setTimeout> | undefined;
  ctx.watch(
    () => JSON.stringify(stage.viewState()),
    (json) => {
      if (!restored) return; // don't clobber saved state before we've applied it
      clearTimeout(timer);
      timer = setTimeout(() => storage.setItem(config.key, json), 200);
    },
  );
  ctx.cleanup(() => clearTimeout(timer));
}
