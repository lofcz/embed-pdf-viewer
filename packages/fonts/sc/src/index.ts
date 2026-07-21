/**
 * @embedpdf/fonts-sc
 *
 * Simplified Chinese (GB2312) fallback fonts - Noto Sans Hans
 * 5 weights: Light (300) to Bold (700) - subset to stay under CDN limits
 *
 * @packageDocumentation
 */

import { FontCharset, type FontFile, type FontPackageMeta } from '@embedpdf/models';

/**
 * Font files included in this package
 */
export const fonts: FontFile[] = [
  { file: 'NotoSansHans-Light.otf', weight: 300 },
  { file: 'NotoSansHans-DemiLight.otf', weight: 350 },
  { file: 'NotoSansHans-Regular.otf', weight: 400 },
  { file: 'NotoSansHans-Medium.otf', weight: 500 },
  { file: 'NotoSansHans-Bold.otf', weight: 700 },
];

/**
 * Package metadata
 */
export const fontsMeta: FontPackageMeta = {
  name: '@embedpdf/fonts-sc',
  fonts,
};

/**
 * Build a font-fallback config that serves fonts from this package (no CDN).
 * Pass the result to `PDFViewer` / `usePdfiumEngine` as `fontFallback`.
 *
 * @example
 * ```ts
 * import { createFontFallback } from '@embedpdf/fonts-sc';
 *
 * <PDFViewer config={{ src: '/doc.pdf', fontFallback: createFontFallback() }} />
 * ```
 */
export function createFontFallback() {
  return {
    fonts: {
      [FontCharset.GB2312]: fonts.map((f) => ({
        url: new URL(/* @vite-ignore */ `../fonts/${f.file}`, import.meta.url).href,
        weight: f.weight,
        italic: f.italic,
      })),
    },
  };
}
