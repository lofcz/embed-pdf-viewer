export type AnnotationMutationKind = 'create' | 'update' | 'delete' | 'move';

export function changesAnnotationList(_kind: AnnotationMutationKind): boolean {
  return true;
}

export function shiftsExistingAnnotationIndices(kind: AnnotationMutationKind): boolean {
  return kind === 'delete' || kind === 'move';
}

export function invalidatesWeakIndexRefs(
  kind: AnnotationMutationKind,
  hadWeakBefore: boolean,
): boolean {
  return shiftsExistingAnnotationIndices(kind) && hadWeakBefore;
}
