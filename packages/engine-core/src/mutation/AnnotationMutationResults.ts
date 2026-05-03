import type { AnnotationDTO } from '../annotation/kinds';
import type { AnnotationStableId } from '../identity/AnnotationStableId';
import type { AnnotationListMutationMeta } from './AnnotationListMutationMeta';

/**
 * Created annotation, fully materialised. The new annotation always has
 * `identityQuality === 'durable'` because the server uses
 * `EPDFPage_GetAnnotByObjectNumber` to read it back after creation.
 */
export interface AnnotationCreateResult {
  created: AnnotationDTO;
  meta: AnnotationListMutationMeta;
}

export interface AnnotationUpdateResult {
  updated: AnnotationDTO;
  meta: AnnotationListMutationMeta;
}

export interface AnnotationDeleteResult {
  deleted: AnnotationStableId;
  meta: AnnotationListMutationMeta;
}
