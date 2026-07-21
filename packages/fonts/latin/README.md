# @embedpdf/fonts-latin

Latin, Cyrillic, Greek, and Vietnamese fallback fonts for EmbedPDF.

## Included Fonts

All 9 weights of Noto Sans, including italic variants (18 fonts total):

| Weight           | Regular                   | Italic                          |
| ---------------- | ------------------------- | ------------------------------- |
| 100 (Thin)       | `NotoSans-Thin.ttf`       | `NotoSans-ThinItalic.ttf`       |
| 200 (ExtraLight) | `NotoSans-ExtraLight.ttf` | `NotoSans-ExtraLightItalic.ttf` |
| 300 (Light)      | `NotoSans-Light.ttf`      | `NotoSans-LightItalic.ttf`      |
| 400 (Regular)    | `NotoSans-Regular.ttf`    | `NotoSans-Italic.ttf`           |
| 500 (Medium)     | `NotoSans-Medium.ttf`     | `NotoSans-MediumItalic.ttf`     |
| 600 (SemiBold)   | `NotoSans-SemiBold.ttf`   | `NotoSans-SemiBoldItalic.ttf`   |
| 700 (Bold)       | `NotoSans-Bold.ttf`       | `NotoSans-BoldItalic.ttf`       |
| 800 (ExtraBold)  | `NotoSans-ExtraBold.ttf`  | `NotoSans-ExtraBoldItalic.ttf`  |
| 900 (Black)      | `NotoSans-Black.ttf`      | `NotoSans-BlackItalic.ttf`      |

## Supported Charsets

This font covers multiple charsets used by PDFium:

- `FontCharset.CYRILLIC` (204) - Russian, Ukrainian, Bulgarian, etc.
- `FontCharset.GREEK` (161) - Greek
- `FontCharset.VIETNAMESE` (163) - Vietnamese


## Usage (recommended — local, no CDN)

```ts
import { createFontFallback } from '@embedpdf/fonts-latin';

fontFallback: createFontFallback();
```

Fonts resolve from this package via `import.meta.url` (Vite/Rollup/webpack 5+).
Combine packs with `mergeFontFallbacks` from `@embedpdf/engines`.

## License

These fonts are licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).

Noto Sans is a trademark of Google LLC.
