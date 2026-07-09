/**
 * @embedpdf-x/plugin-annotation — annotations on the v3 stack.
 *
 * The pure @embedpdf-x/annotation-core wired to the engine repository (optimistic
 * create/patch/delete) and the interaction hub (ambient editing + draw tools).
 * Behaviors (forms, links) plug in via registerBehavior. Zero framework code.
 */
import type { CapabilityToken } from '@embedpdf-x/kernel';
import { AnnotationToken as AnnotationHostToken } from './types';
import type { AnnotationCapability } from './types';

export { annotationPlugin } from './annotation.plugin';
export { fromDTO, toCreateDraft, toPatch, refKey, styleFromDTO } from './repository';
export { DEFAULT_CHROME } from './reducer';
export { DEFAULT_TOOLS } from './tools';
export type {
  AnnotationToolDef,
  AnnotationToolInput,
  InkAuthoringOptions,
  SelectionAuthoring,
  StampSourceSpec,
  ToolAuthoringKind,
  ToolDefaultsFor,
} from './tools';
export type {
  AnnotationCapability,
  AnnotationConfig,
  AnnotationState,
  AnnotationAction,
  Behavior,
  ChromeSettings,
  ChromeSettingsPatch,
  SelectionProps,
  StampProvider,
  StampPromptRequest,
  StampToolInput,
  TextItem,
} from './types';
// The property vocabulary + schema (defined in the portable core; re-exported so
// app code building property UIs needs only this package).
export { propsFor } from '@embedpdf-x/annotation-core';
export type {
  AnnotationProps,
  AnnotationPropsPatch,
  BlendMode,
  Border,
  LineEnding,
  LineEndings,
  PropKey,
  PropSpec,
  SnapSettings,
  TextAlign,
} from '@embedpdf-x/annotation-core';

/**
 * App-facing annotation token: resolves the public {@link AnnotationCapability}.
 * It is the SAME runtime token the plugin provides, narrowed to the public lens —
 * the framework-only surface (render projection, pointer gestures, behavior
 * registration) is reachable only via `@embedpdf-x/plugin-annotation/internal`.
 */
export const AnnotationToken =
  AnnotationHostToken as unknown as CapabilityToken<AnnotationCapability>;
