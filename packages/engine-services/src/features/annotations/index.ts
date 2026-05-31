export { AnnotationReader } from './AnnotationReader';
export { RawAnnotationReader } from './RawAnnotationReader';
export { AnnotationMutator } from './AnnotationMutator';
export { MutationImpactComputer } from './internal/mutations/computeMutationImpact';
export type { MutationKind, ImpactInputs } from './internal/mutations/computeMutationImpact';

// Temporary compatibility aliases while downstream code moves to the clearer names.
export { AnnotationReader as FullAnnotationReader } from './AnnotationReader';
export { AnnotationMutator as DocumentAnnotationMutator } from './AnnotationMutator';
export { MutationImpactComputer as ImpactComputer } from './internal/mutations/computeMutationImpact';
