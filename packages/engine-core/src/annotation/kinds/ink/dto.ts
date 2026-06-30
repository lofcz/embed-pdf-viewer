import type { InkList } from '../../../geometry/primitives';
import type { AnnotationBase } from '../../base';
import type { GeometryStyleFields } from '../style.shared';

export type InkAnnotationDTO = AnnotationBase & {
  subtype: 'ink';
  /** `/InkList` — the freehand pen strokes (array of point paths). */
  inkList: InkList;
  /** `/EMBD_Metadata/Rotation` — advisory rotation (deg); strokes are already
   *  rotated. No `unrotatedRect`, so it is inert for AP. */
  rotation?: number;
} & GeometryStyleFields;
