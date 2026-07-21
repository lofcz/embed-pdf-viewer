# @embedpdf/fonts-hebrew

Hebrew fallback fonts for EmbedPDF.

## Included Fonts

- `NotoSansHebrew-Regular.ttf` - Regular weight (400)
- `NotoSansHebrew-Bold.ttf` - Bold weight (700)


## Usage (recommended — local, no CDN)

```ts
import { createFontFallback } from '@embedpdf/fonts-hebrew';

fontFallback: createFontFallback();
```

Fonts resolve from this package via `import.meta.url` (Vite/Rollup/webpack 5+).
Combine packs with `mergeFontFallbacks` from `@embedpdf/engines`.

## License

These fonts are licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).

Noto Sans Hebrew is a trademark of Google LLC.
