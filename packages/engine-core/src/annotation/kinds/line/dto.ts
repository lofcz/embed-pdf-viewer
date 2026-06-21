import type { LinePoints } from '../../../geometry/primitives';
import type { AnnotationBase } from '../../base';
import type { LineEndings } from '../../primitives';
import type { StrokeFillFields } from '../stroke-style.shared';

export type LineAnnotationDTO = AnnotationBase & {
  subtype: 'line';
  /** `/L` the two endpoints of the line. */
  linePoints: LinePoints;
  /** `/LE` the start/end line endings. */
  lineEndings: LineEndings;
} & StrokeFillFields;
