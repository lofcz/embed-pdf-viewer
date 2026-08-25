/**
 * Combine several font-fallback lists (e.g. from `@embedpdf/fonts-*`
 * helpers) into one array for `localEngine({ fallbackFonts })`.
 *
 * Later configs win on overlapping `key`s — the v3 counterpart of v2
 * `mergeFontFallbacks`, which overwrote colliding charset keys via
 * `Object.assign`. First-seen key order is preserved; only the spec is
 * replaced.
 */
export function mergeFontFallbacks<T extends { key: string }>(
  ...configs: Array<readonly T[] | null | undefined>
): T[] {
  const byKey = new Map<string, T>();
  for (const config of configs) {
    if (!config) continue;
    for (const spec of config) {
      byKey.set(spec.key, spec);
    }
  }
  return [...byKey.values()];
}
