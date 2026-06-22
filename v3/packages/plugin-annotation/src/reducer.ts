import { initialModel } from '@embedpdf-x/annotation-core';
import type { AnnotationAction, AnnotationState } from './types';

/**
 * The slice just holds the annotation-core Model. The pure `update` runs in the
 * capability (the shell, which also performs effects); the reducer only stores
 * the new model — keeping the kernel store a dumb, serializable container.
 */
export const initialAnnotationState: AnnotationState = { model: initialModel };

export const annotationReducer = (
  state: AnnotationState,
  action: AnnotationAction,
): AnnotationState => (action.type === 'SET_MODEL' ? { model: action.model } : state);
