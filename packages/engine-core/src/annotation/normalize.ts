import type { WireResourceMap } from '../resource/BinarySource';
import type {
  AnnotationDraft,
  AnnotationPatch,
  WireAnnotationDraft,
  WireAnnotationPatch,
} from './kinds';
// Deep import (not the kind barrel): keeps this module — and the zod-free
// `shared` entrypoint that re-exports it — free of the stamp Zod schemas.
import { normalizeStampDraft, normalizeStampPatch } from './kinds/stamp/normalize';

/**
 * The one shared splitter between authoring and wire forms — every engine
 * (local, cloud) and no one else runs this; transports never reimplement it.
 *
 * Uniform rule, zero per-kind exceptions: any `BinarySource` field on a
 * draft/patch is replaced by `{ resource: key }` and its bytes move into
 * the returned `WireResourceMap` (worker: transfer list; cloud: multipart
 * `resource:{key}` parts). Kinds without binary fields pass through
 * untouched with an empty map — their wire form IS their authoring form.
 *
 * Zod-free by design: schemas validate the returned wire form; the
 * authoring types are TypeScript-only sugar.
 */

export interface NormalizedDraft {
  wire: WireAnnotationDraft;
  resources: WireResourceMap;
}

export interface NormalizedPatch {
  wire: WireAnnotationPatch;
  resources: WireResourceMap;
}

function createResourceKeyAllocator(): () => string {
  let next = 0;
  return () => `r${next++}`;
}

export async function normalizeAnnotationDraft(draft: AnnotationDraft): Promise<NormalizedDraft> {
  switch (draft.subtype) {
    case 'stamp':
      return normalizeStampDraft(draft, createResourceKeyAllocator());
    default:
      return { wire: draft, resources: {} };
  }
}

export async function normalizeAnnotationPatch(patch: AnnotationPatch): Promise<NormalizedPatch> {
  switch (patch.subtype) {
    case 'stamp':
      return normalizeStampPatch(patch, createResourceKeyAllocator());
    default:
      return { wire: patch, resources: {} };
  }
}
