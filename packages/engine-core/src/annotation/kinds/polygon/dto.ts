import type { PdfRectDifferences } from '../../primitives';
import type { VertexDTO } from '../vertex.shared';

export type PolygonAnnotationDTO = VertexDTO<'polygon'> & {
  cloudyIntensity?: number;
  rectDifferences?: PdfRectDifferences;
};
