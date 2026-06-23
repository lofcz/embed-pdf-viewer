import type { CalloutLine, PdfRect } from '../../../geometry/primitives';
import type { AnnotationPatchBase } from '../../patch-base';
import type {
  AnnotationBorderStyle,
  Color,
  FreeTextIntent,
  LineEnding,
  PdfRectDifferences,
  StandardFont,
  TextAlignment,
} from '../../primitives';

export interface FreeTextPatch extends AnnotationPatchBase {
  subtype: 'free-text';
  intent?: FreeTextIntent;

  fontFamily?: StandardFont;
  fontSize?: number;
  textAlign?: TextAlignment;

  rect?: PdfRect;

  color?: Color;
  fontColor?: Color;
  interiorColor?: Color | null;
  opacity?: number;

  strokeWidth?: number;
  borderStyle?: AnnotationBorderStyle;
  dashArray?: number[];
  rectDifferences?: PdfRectDifferences;

  calloutLine?: CalloutLine;
  lineEnding?: LineEnding;
}
