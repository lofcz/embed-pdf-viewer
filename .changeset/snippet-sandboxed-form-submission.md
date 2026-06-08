---
"@embedpdf/snippet": patch
---

Fix UI actions that relied on native HTML form submission failing inside sandboxed iframes without the `allow-forms` permission. The comment input, zoom percentage input, and link modal now trigger their handlers via explicit button clicks and Enter keydown instead of form submission, so they work in sandboxed contexts while behaving identically everywhere else.
