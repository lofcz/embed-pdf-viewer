---
"@embedpdf/snippet": patch
"@embedpdf/engines": patch
---

Fix `fontFallback: null` not disabling the default jsDelivr CDN font fallback. The snippet previously stripped `null` with a truthy filter before it reached the worker, so the worker fell back to the CDN config. The value is now forwarded correctly (preserving `null` while still omitting an unset option), and the `fontFallback` type is widened to `FontFallbackConfig | null` across the engine hooks/options so the documented airgapped opt-out is type-correct end to end.
