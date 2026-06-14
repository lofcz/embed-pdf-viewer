import { PageEditToken, type PageEditCapability } from '@embedpdf-x/plugin-page-edit';
import { useCapability } from './runtime';

/**
 * The page-edit capability, bound to the surrounding `DocumentScope`.
 *
 * Thin idiomatic wrapper over `PageEditToken` — the relative→absolute rotation
 * and PON addressing live in the plugin, so this hook (and its Vue/Svelte/
 * Angular siblings) is pure binding sugar with no logic to drift.
 *
 *   const editor = usePageEditor();
 *   editor.rotateBy(page.pon, 90);
 *   if (editor.canEdit()) { … }
 */
export function usePageEditor(): PageEditCapability {
  return useCapability(PageEditToken);
}
