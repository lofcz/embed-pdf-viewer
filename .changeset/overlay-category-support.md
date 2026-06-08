---
"@embedpdf/plugin-ui": patch
---

Overlays now participate in the category visibility system. The schema analyzer collects overlay `categories` (and `visibilityDependsOn`), so category visibility CSS is generated for them and they can be hidden via `disabledCategories` like any other UI item.
