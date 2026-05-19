---
'@embedpdf/snippet': patch
---

Add Brazilian Portuguese (`pt-BR`) as a built-in locale of the snippet viewer.

- New `brazilianPortugueseTranslations` export from `@embedpdf/snippet`, covering the full translation schema so users see localised strings everywhere (search panel, password prompt, document-error dialog, outline, comments, blend-mode picker, link dialog, full protect/security flows, signature flow, etc.) — no English fallback noise.
- Registered in the default `i18n.locales` array alongside the existing nine locales, so the viewer's language picker now lists "Português (Brasil)" out of the box.
- The wide-label responsive override that used to be German/Dutch-only now also applies to `pt-BR`, because words like "Visualizar" (10) and "Formulário" (10) are as wide as German labels and would otherwise overflow the toolbar at the `md` breakpoint. The override group id was renamed from `germanic-languages` to `wide-label-languages` to reflect the broader scope; behaviour for `de`/`nl` is unchanged.
