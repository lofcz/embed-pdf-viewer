---
"@embedpdf/snippet": patch
---

Allow hiding the UnlockOwnerOverlay (the read-only notice shown on encrypted, permission-restricted PDFs) via `disabledCategories`. The overlay renderer now emits the `data-epdf-cat` attribute, and the `unlock-owner-overlay` overlay carries the new `security` / `security-unlock-overlay` categories, so viewer-only integrations can remove it with `disabledCategories: ['security-unlock-overlay']` (or the parent `security`).
