import type { InkList } from '../../../geometry/primitives';
import type { AnnotationBase } from '../../base';
import type { GeometryStyleFields } from '../style.shared';

export type InkAnnotationDTO = AnnotationBase & {
  subtype: 'ink';
  /** `/InkList` — the freehand pen strokes (array of point paths). */
  inkList: InkList;
} & GeometryStyleFields;
