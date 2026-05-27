import { describe, expect, it } from 'vitest';
import { decodePdfBits, PDF_BITS } from '../../src/auth/scope';
import {
  cdnCoverageForScope,
  checkResourceAccess,
  DOC_RESOURCES,
  type DocResourceId,
} from '../../src/wire/resources';

const NO_BITS = decodePdfBits(null);
const BIT5 = decodePdfBits(PDF_BITS.COPY);
const BIT6 = decodePdfBits(PDF_BITS.ANNOTATE_FILL);

describe('DOC_RESOURCES — structural invariants', () => {
  it('every entry has matching id and key', () => {
    for (const [key, descriptor] of Object.entries(DOC_RESOURCES)) {
      expect(descriptor.id).toBe(key);
    }
  });

  it('every entry has a non-empty path pattern', () => {
    for (const r of Object.values(DOC_RESOURCES)) {
      expect(r.pathPattern.length).toBeGreaterThan(0);
      expect(r.pathPattern).toMatch(/^\/v1\/docs\//);
    }
  });

  it('resolvePathPattern substitutes docId and layerName', () => {
    for (const r of Object.values(DOC_RESOURCES)) {
      const resolved = r.resolvePathPattern('doc_123', 'mylayer');
      expect(resolved).toContain('doc_123');
      expect(resolved).not.toContain('{docId}');
      expect(resolved).not.toContain('{layerName}');
    }
  });

  it('origin routes are not cacheable', () => {
    for (const r of Object.values(DOC_RESOURCES)) {
      if (r.routeKind === 'origin') expect(r.cdnCacheable).toBe(false);
    }
  });

  it('head and download-current are origin/not-cacheable', () => {
    expect(DOC_RESOURCES.head.routeKind).toBe('origin');
    expect(DOC_RESOURCES.head.cdnCacheable).toBe(false);
    expect(DOC_RESOURCES['download-current'].routeKind).toBe('origin');
    expect(DOC_RESOURCES['download-current'].cdnCacheable).toBe(false);
  });

  it('manifest and page-* and download-versioned are versioned/cacheable', () => {
    const cacheable: DocResourceId[] = [
      'manifest',
      'page-render',
      'page-text',
      'page-geometry',
      'annotations-read',
      'download-versioned',
    ];
    for (const id of cacheable) {
      expect(DOC_RESOURCES[id].routeKind).toBe('versioned-read');
      expect(DOC_RESOURCES[id].cdnCacheable).toBe(true);
    }
  });
});

describe('DOC_RESOURCES — capability mapping', () => {
  it('head requires doc.open', () => {
    expect(DOC_RESOURCES.head.requirement).toEqual({
      kind: 'single',
      capability: 'doc.open',
    });
  });

  it('manifest requires doc.open', () => {
    expect(DOC_RESOURCES.manifest.requirement).toEqual({
      kind: 'single',
      capability: 'doc.open',
    });
  });

  it('page-render requires doc.render', () => {
    expect(DOC_RESOURCES['page-render'].requirement).toEqual({
      kind: 'single',
      capability: 'doc.render',
    });
  });

  it('page-text requires doc.text.copy (NOT doc.text.search)', () => {
    expect(DOC_RESOURCES['page-text'].requirement).toEqual({
      kind: 'single',
      capability: 'doc.text.copy',
    });
  });

  it('page-geometry requires doc.text.select (NOT doc.text.search)', () => {
    expect(DOC_RESOURCES['page-geometry'].requirement).toEqual({
      kind: 'single',
      capability: 'doc.text.select',
    });
  });

  it('annotations-read requires doc.annotate.read', () => {
    expect(DOC_RESOURCES['annotations-read'].requirement).toEqual({
      kind: 'single',
      capability: 'doc.annotate.read',
    });
  });

  it('both download variants require doc.download', () => {
    expect(DOC_RESOURCES['download-current'].requirement).toEqual({
      kind: 'single',
      capability: 'doc.download',
    });
    expect(DOC_RESOURCES['download-versioned'].requirement).toEqual({
      kind: 'single',
      capability: 'doc.download',
    });
  });
});

describe('checkResourceAccess', () => {
  it('wildcard scope grants every resource', () => {
    for (const id of Object.keys(DOC_RESOURCES) as DocResourceId[]) {
      expect(checkResourceAccess(id, ['*'], NO_BITS)).toBe(true);
    }
  });

  it('empty scope grants nothing (deny by default)', () => {
    for (const id of Object.keys(DOC_RESOURCES) as DocResourceId[]) {
      expect(checkResourceAccess(id, [], NO_BITS)).toBe(false);
    }
  });

  it('explicit doc.open grants head and manifest but not page-render', () => {
    expect(checkResourceAccess('head', ['doc.open'], NO_BITS)).toBe(true);
    expect(checkResourceAccess('manifest', ['doc.open'], NO_BITS)).toBe(true);
    expect(checkResourceAccess('page-render', ['doc.open'], NO_BITS)).toBe(false);
  });

  it('pdf.permissions + bit5 grants page-text and page-geometry', () => {
    expect(checkResourceAccess('page-text', ['pdf.permissions'], BIT5)).toBe(true);
    expect(checkResourceAccess('page-geometry', ['pdf.permissions'], BIT5)).toBe(true);
  });

  it('pdf.permissions always grants head + manifest + page-render', () => {
    // doc.open and doc.render are always-on under pdf.permissions
    expect(checkResourceAccess('head', ['pdf.permissions'], NO_BITS)).toBe(true);
    expect(checkResourceAccess('manifest', ['pdf.permissions'], NO_BITS)).toBe(true);
    expect(checkResourceAccess('page-render', ['pdf.permissions'], NO_BITS)).toBe(true);
  });

  it('pdf.permissions does NOT grant cloud-only resources without explicit cap', () => {
    expect(checkResourceAccess('download-current', ['pdf.permissions'], BIT5)).toBe(false);
    expect(checkResourceAccess('download-versioned', ['pdf.permissions'], BIT5)).toBe(false);
  });

  it('annotations-read granted via doc.annotate.read alone', () => {
    expect(checkResourceAccess('annotations-read', ['doc.annotate.read'], NO_BITS)).toBe(true);
  });

  it('annotations-read granted via doc.annotate.modify (implication)', () => {
    expect(checkResourceAccess('annotations-read', ['doc.annotate.modify'], NO_BITS)).toBe(true);
  });

  it('annotations-read granted via collab scope (implication)', () => {
    expect(checkResourceAccess('annotations-read', ['annotations:update:self'], NO_BITS)).toBe(
      true,
    );
  });

  it('annotations-read granted via pdf.permissions + bit6', () => {
    expect(checkResourceAccess('annotations-read', ['pdf.permissions'], BIT6)).toBe(true);
  });
});

describe('cdnCoverageForScope', () => {
  it('returns empty for empty scope', () => {
    expect(cdnCoverageForScope([], NO_BITS, { docId: 'doc_1' })).toEqual([]);
  });

  it('wildcard scope covers every cacheable resource', () => {
    const coverage = cdnCoverageForScope(['*'], NO_BITS, {
      docId: 'doc_1',
      layerName: 'L1',
    });
    // Should be exactly the cacheable resources
    const expected = Object.values(DOC_RESOURCES)
      .filter((r) => r.cdnCacheable)
      .map((r) => r.resolvePathPattern('doc_1', 'L1'));
    expect(new Set(coverage)).toEqual(new Set(expected));
  });

  it('never includes head or download-current', () => {
    const coverage = cdnCoverageForScope(['*'], NO_BITS, { docId: 'doc_1' });
    expect(coverage.some((p) => p.endsWith('/head'))).toBe(false);
    expect(coverage.some((p) => p === '/v1/docs/doc_1/layers/default/download')).toBe(false);
  });

  it('a single capability scope covers only resources gated by that capability', () => {
    const coverage = cdnCoverageForScope(['doc.render'], NO_BITS, { docId: 'doc_1' });
    expect(coverage).toEqual(['/v1/docs/doc_1/pages/*/render@*']);
  });

  it('layer-bearing patterns use the supplied layerName', () => {
    const coverage = cdnCoverageForScope(['doc.annotate.read'], NO_BITS, {
      docId: 'doc_1',
      layerName: 'myLayer',
    });
    expect(coverage).toEqual(['/v1/docs/doc_1/layers/myLayer/pages/*/annotations@*']);
  });

  it('layer-bearing patterns default to "default" when layerName is omitted', () => {
    const coverage = cdnCoverageForScope(['doc.annotate.read'], NO_BITS, {
      docId: 'doc_1',
    });
    expect(coverage).toEqual(['/v1/docs/doc_1/layers/default/pages/*/annotations@*']);
  });

  it('pdf.permissions + bit5 + bit6 covers manifest, render, text, geometry, annotations', () => {
    const bits = decodePdfBits(PDF_BITS.COPY | PDF_BITS.ANNOTATE_FILL);
    const coverage = cdnCoverageForScope(['pdf.permissions'], bits, {
      docId: 'doc_1',
      layerName: 'default',
    });
    expect(new Set(coverage)).toEqual(
      new Set([
        '/v1/docs/doc_1/manifest@*',
        '/v1/docs/doc_1/pages/*/render@*',
        '/v1/docs/doc_1/pages/*/text@*',
        '/v1/docs/doc_1/pages/*/geometry@*',
        '/v1/docs/doc_1/layers/default/pages/*/annotations@*',
      ]),
    );
    // download is cloud-only — not granted by pdf.permissions
    expect(coverage.some((p) => p.includes('download'))).toBe(false);
  });
});
