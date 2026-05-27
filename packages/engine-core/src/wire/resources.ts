/**
 * Single source of truth mapping every CDN-relevant read resource to:
 *   - its URL path pattern (with glob wildcards for CDN signing)
 *   - the capability requirement that gates it
 *   - whether it's CDN-cacheable
 *   - whether the route is origin-only or versioned-read
 *
 * Consumed by:
 *   - server route guards via `requireResource(req, docId, id, pdfBits)`
 *   - the CDN signer to determine which path prefixes to cover for a token
 *   - documentation generators
 *
 * NOTE: only READ resources go in this table. Mutation routes
 * (POST/PATCH/DELETE) use collab scopes with target lookup and don't
 * fit a single capability requirement. /access is also NOT in the
 * table — it's a session-establishment POST that performs its own
 * doc-access check without requiring any capability.
 */

import type { DocCapability, PdfBits } from '../auth/scope';
import { checkAnyCapability, checkCapability } from '../auth/scope';

/**
 * Canonical id for every read resource the server exposes.
 *
 * Adding a new resource:
 *   1. Add the id to this union
 *   2. Add a `DOC_RESOURCES` entry
 *   3. Update the route handler to call `requireResource(req, docId, '<id>', pdfBits)`
 *   4. CDN signer automatically considers it
 */
export type DocResourceId =
  | 'head'
  | 'manifest'
  | 'page-render'
  | 'page-text'
  | 'page-geometry'
  | 'annotations-read'
  | 'download-current'
  | 'download-versioned';

/**
 * 'origin' — unversioned URL, response can change over time. CDN must
 * not cache (the bytes are not immutable). Routed straight to origin
 * with the JWT bearer.
 *
 * 'versioned-read' — URL is content-addressed via `@<token>`. Response
 * is immutable for the lifetime of the version. Safe to cache forever
 * at the CDN edge.
 */
export type RouteKind = 'origin' | 'versioned-read';

/**
 * Capability requirement attached to a resource. Two shapes:
 *   - `single` — one capability gates the resource
 *   - `any`    — any one of N capabilities gates the resource
 *               (used by /text and /geometry which accept either the
 *                copy/select scope OR the future search scope)
 */
export type CapabilityRequirement =
  | { kind: 'single'; capability: DocCapability }
  | { kind: 'any'; capabilities: ReadonlyArray<DocCapability> };

export interface DocResourceDescriptor {
  /** Stable id used by route guards and the CDN signer. */
  id: DocResourceId;
  /**
   * Display pattern with `{docId}` / `{layerName}` placeholders for
   * docs + telemetry. Use {@link DocResourceDescriptor.resolvePathPattern}
   * to get a concrete pattern with values filled in.
   */
  pathPattern: string;
  /**
   * Concrete CDN path pattern with `*` wildcards. Used by the CDN
   * signer to mint coverage. For path prefixes with no layer
   * component, `layerName` is ignored.
   */
  resolvePathPattern(docId: string, layerName?: string): string;
  /** What capability (or set) is needed to access this resource. */
  requirement: CapabilityRequirement;
  /** Versioned-immutable vs. unversioned-mutable. */
  routeKind: RouteKind;
  /**
   * Can the CDN sign coverage for this resource? Mutable/unversioned
   * resources (head, current download) are always false even though
   * they're routed via origin.
   */
  cdnCacheable: boolean;
}

export const DOC_RESOURCES: Readonly<Record<DocResourceId, DocResourceDescriptor>> = {
  head: {
    id: 'head',
    pathPattern: '/v1/docs/{docId}/head',
    resolvePathPattern: (docId) => `/v1/docs/${docId}/head`,
    requirement: { kind: 'single', capability: 'doc.open' },
    routeKind: 'origin',
    cdnCacheable: false,
  },
  manifest: {
    id: 'manifest',
    pathPattern: '/v1/docs/{docId}/manifest@*',
    resolvePathPattern: (docId) => `/v1/docs/${docId}/manifest@*`,
    requirement: { kind: 'single', capability: 'doc.open' },
    routeKind: 'versioned-read',
    cdnCacheable: true,
  },
  'page-render': {
    id: 'page-render',
    pathPattern: '/v1/docs/{docId}/pages/*/render@*',
    resolvePathPattern: (docId) => `/v1/docs/${docId}/pages/*/render@*`,
    requirement: { kind: 'single', capability: 'doc.render' },
    routeKind: 'versioned-read',
    cdnCacheable: true,
  },
  'page-text': {
    id: 'page-text',
    pathPattern: '/v1/docs/{docId}/pages/*/text@*',
    resolvePathPattern: (docId) => `/v1/docs/${docId}/pages/*/text@*`,
    // Only doc.text.copy gates /text. doc.text.search is reserved for a
    // future dedicated /search endpoint and intentionally does NOT
    // grant /text access here.
    requirement: { kind: 'single', capability: 'doc.text.copy' },
    routeKind: 'versioned-read',
    cdnCacheable: true,
  },
  'page-geometry': {
    id: 'page-geometry',
    pathPattern: '/v1/docs/{docId}/pages/*/geometry@*',
    resolvePathPattern: (docId) => `/v1/docs/${docId}/pages/*/geometry@*`,
    // Same logic as /text: search is reserved for a future endpoint.
    requirement: { kind: 'single', capability: 'doc.text.select' },
    routeKind: 'versioned-read',
    cdnCacheable: true,
  },
  'annotations-read': {
    id: 'annotations-read',
    pathPattern: '/v1/docs/{docId}/layers/{layerName}/pages/*/annotations@*',
    resolvePathPattern: (docId, layerName = 'default') =>
      `/v1/docs/${docId}/layers/${layerName}/pages/*/annotations@*`,
    requirement: { kind: 'single', capability: 'doc.annotate.read' },
    routeKind: 'versioned-read',
    cdnCacheable: true,
  },
  'download-current': {
    id: 'download-current',
    pathPattern: '/v1/docs/{docId}/layers/{layerName}/download',
    resolvePathPattern: (docId, layerName = 'default') =>
      `/v1/docs/${docId}/layers/${layerName}/download`,
    requirement: { kind: 'single', capability: 'doc.download' },
    routeKind: 'origin',
    cdnCacheable: false,
  },
  'download-versioned': {
    id: 'download-versioned',
    pathPattern: '/v1/docs/{docId}/layers/{layerName}/download@*',
    resolvePathPattern: (docId, layerName = 'default') =>
      `/v1/docs/${docId}/layers/${layerName}/download@*`,
    requirement: { kind: 'single', capability: 'doc.download' },
    routeKind: 'versioned-read',
    cdnCacheable: true,
  },
};

/**
 * True iff the scope grants access to the named resource.
 *
 * Looks up the resource descriptor, then dispatches to
 * `checkCapability` or `checkAnyCapability` based on the requirement
 * shape. Used by both server route guards and the CDN signer.
 */
export function checkResourceAccess(
  resourceId: DocResourceId,
  rawScope: ReadonlyArray<string>,
  pdfBits: PdfBits,
): boolean {
  const r = DOC_RESOURCES[resourceId];
  switch (r.requirement.kind) {
    case 'single':
      return checkCapability(r.requirement.capability, rawScope, pdfBits);
    case 'any':
      return checkAnyCapability(r.requirement.capabilities, rawScope, pdfBits);
  }
}

/**
 * Enumerate the CDN-cacheable resources the scope can access. Returns
 * the resolved path patterns ready to be handed to a CDN signer.
 *
 * Resources that are not cacheable (head, download-current) are
 * filtered out automatically — they're still gated by their
 * `requirement` at the origin route, but the CDN never gets a
 * credential for them.
 */
export function cdnCoverageForScope(
  rawScope: ReadonlyArray<string>,
  pdfBits: PdfBits,
  context: { docId: string; layerName?: string },
): string[] {
  const out: string[] = [];
  for (const id of Object.keys(DOC_RESOURCES) as DocResourceId[]) {
    const r = DOC_RESOURCES[id];
    if (!r.cdnCacheable) continue;
    if (!checkResourceAccess(id, rawScope, pdfBits)) continue;
    out.push(r.resolvePathPattern(context.docId, context.layerName));
  }
  return out;
}
