# @embedpdf/fonts-jp

Japanese (Shift-JIS) fallback fonts for EmbedPDF.

## Included Fonts

All 7 weights of Noto Sans JP:

- `NotoSansJP-Thin.otf` - Thin weight (100)
- `NotoSansJP-Light.otf` - Light weight (300)
- `NotoSansJP-DemiLight.otf` - DemiLight weight (350)
- `NotoSansJP-Regular.otf` - Regular weight (400)
- `NotoSansJP-Medium.otf` - Medium weight (500)
- `NotoSansJP-Bold.otf` - Bold weight (700)
- `NotoSansJP-Black.otf` - Black weight (900)


## Usage (recommended — local, no CDN)

```ts
import { createFontFallback } from '@embedpdf/fonts-jp';

fontFallback: createFontFallback();
```

Fonts resolve from this package via `import.meta.url` (Vite/Rollup/webpack 5+).
Combine packs with `mergeFontFallbacks` from `@embedpdf/engines`.

## License

These fonts are licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).

Noto Sans JP is a trademark of Google LLC.
