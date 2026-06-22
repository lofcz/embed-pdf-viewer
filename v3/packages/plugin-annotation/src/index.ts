/**
 * @embedpdf-x/plugin-annotation — annotations on the v3 stack.
 *
 * The pure @embedpdf-x/annotation-core wired to the engine repository (optimistic
 * create/patch/delete) and the interaction hub (ambient editing + draw tools).
 * Behaviors (forms, links) plug in via registerBehavior. Zero framework code.
 */
export { annotationPlugin } from './annotation.plugin';
export { createAnnotationCapability } from './capability';
export { fromDTO, toCreateDraft, toPatch, refKey } from './repository';
export { AnnotationToken } from './types';
export type { AnnotationCapability, AnnotationState, AnnotationAction, Behavior } from './types';
