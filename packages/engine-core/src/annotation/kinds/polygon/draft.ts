import type { AnnotationDraftBase } from '../../draft-base';
import type { PdfRectDifferences } from '../../primitives';
import type { VertexDraftFields } from '../vertex.shared';

export interface PolygonDraft extends AnnotationDraftBase, VertexDraftFields {
  subtype: 'polygon';
  cloudyIntensity?: number;
  rectDifferences?: PdfRectDifferences;
}
