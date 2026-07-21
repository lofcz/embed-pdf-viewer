# @embedpdf/fonts-kr

Korean (Hangeul) fallback fonts for EmbedPDF.

## Included Fonts

All 7 weights of Noto Sans KR:

- `NotoSansKR-Thin.otf` - Thin weight (100)
- `NotoSansKR-Light.otf` - Light weight (300)
- `NotoSansKR-DemiLight.otf` - DemiLight weight (350)
- `NotoSansKR-Regular.otf` - Regular weight (400)
- `NotoSansKR-Medium.otf` - Medium weight (500)
- `NotoSansKR-Bold.otf` - Bold weight (700)
- `NotoSansKR-Black.otf` - Black weight (900)


## Usage (recommended — local, no CDN)

```ts
import { createFontFallback } from '@embedpdf/fonts-kr';

fontFallback: createFontFallback();
```

Fonts resolve from this package via `import.meta.url` (Vite/Rollup/webpack 5+).
Combine packs with `mergeFontFallbacks` from `@embedpdf/engines`.

## License

These fonts are licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).

Noto Sans KR is a trademark of Google LLC.
