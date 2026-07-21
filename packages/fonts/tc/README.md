# @embedpdf/fonts-tc

Traditional Chinese (Big5) fallback fonts for EmbedPDF.

## Included Fonts

All 7 weights of Noto Sans Hant (Traditional Chinese):

- `NotoSansHant-Thin.otf` - Thin weight (100)
- `NotoSansHant-Light.otf` - Light weight (300)
- `NotoSansHant-DemiLight.otf` - DemiLight weight (350)
- `NotoSansHant-Regular.otf` - Regular weight (400)
- `NotoSansHant-Medium.otf` - Medium weight (500)
- `NotoSansHant-Bold.otf` - Bold weight (700)
- `NotoSansHant-Black.otf` - Black weight (900)


## Usage (recommended — local, no CDN)

```ts
import { createFontFallback } from '@embedpdf/fonts-tc';

fontFallback: createFontFallback();
```

Fonts resolve from this package via `import.meta.url` (Vite/Rollup/webpack 5+).
Combine packs with `mergeFontFallbacks` from `@embedpdf/engines`.

## License

These fonts are licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).

Noto Sans Hant is a trademark of Google LLC.
