---
"@embedpdf/snippet": patch
---

Fix the "Shapes" mode tab and its overflow-menu entry staying visible when `annotation-shape` is added to `disabledCategories`. The shapes mode entries now carry the `annotation-shape` category (matching the convention used by the insert/form/redact modes), so disabling that category hides the tab and disables the `mode:shapes` command alongside the already-hidden shape tools.
