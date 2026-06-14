/**
 * The ONE place an engine is chosen. Everything else in the app is engine-agnostic
 * — it only speaks the @embedpdf/engine-core `Engine` contract, so swapping the
 * implementation here changes nothing above it.
 *
 * Pick with ?engine=local|cloud  (default: local wasm)
 *   local — @embedpdf/engine: PDFium wasm in a Worker thread (real rendering)
 *   cloud — @cloudpdf/engine: the same contract over HTTP (needs a running server)
 */
import type { Engine, OpenInput } from '@embedpdf-x/kernel';
import type { InitialDocument } from '@embedpdf-x/react';

export type EngineMode = 'local' | 'cloud';

export const engineMode: EngineMode =
  (new URLSearchParams(window.location.search).get('engine') as EngineMode | null) ?? 'local';

export async function createEngine(): Promise<Engine> {
  switch (engineMode) {
    case 'cloud': {
      // Same Engine contract, served over HTTP. Requires ee/server + a token.
      const { createCloudEngine } = await import('@cloudpdf/engine');
      return createCloudEngine({
        baseUrl: import.meta.env.VITE_CLOUDPDF_URL ?? 'http://127.0.0.1:3000',
        token: import.meta.env.VITE_CLOUDPDF_TOKEN,
      });
    }
    case 'local':
    default: {
      const { createLocalEngineWithWorker } = await import('@embedpdf/engine');
      const { default: EngineWorker } = await import('@embedpdf/engine/worker-entry?worker');
      return createLocalEngineWithWorker({ worker: new EngineWorker() });
    }
  }
}

// Sample documents shipped in /public. For cloud they'd address server documents
// by id/token instead of carrying bytes.
const SAMPLES: ReadonlyArray<{ id: string; name: string; url: string }> = [
  { id: 'ebook', name: 'Ebook', url: '/ebook.pdf' },
  { id: 'ebook2', name: 'Ebook Rotated', url: '/ebook-rotated.pdf' },
  { id: 'mixed sizes', name: 'Mixed Sizes', url: '/mixed_page_sizes_test.pdf' },
  { id: 'report', name: 'Report', url: '/report.pdf' },
  { id: 'manual', name: 'Manual', url: '/manual.pdf' },
];

const fetchBytes = async (url: string): Promise<Uint8Array> =>
  new Uint8Array(await (await fetch(url)).arrayBuffer());

async function loadInitialDocuments(): Promise<InitialDocument[]> {
  if (engineMode === 'cloud') {
    return SAMPLES.map(({ id, name }) => ({ source: { kind: 'id', id } as OpenInput, name }));
  }
  return Promise.all(
    SAMPLES.map(async ({ id, name, url }) => ({
      source: { kind: 'bytes', id, bytes: await fetchBytes(url) } as OpenInput,
      name,
    })),
  );
}

export interface Boot {
  engine: Engine;
  documents: InitialDocument[];
}

export async function bootstrap(): Promise<Boot> {
  const [engine, documents] = await Promise.all([createEngine(), loadInitialDocuments()]);
  return { engine, documents };
}

let untitledSeq = 0;
export async function newDocument(): Promise<InitialDocument> {
  untitledSeq += 1;
  const id = `untitled-${untitledSeq}-${Math.round(performance.now())}`;
  const source: OpenInput =
    engineMode === 'cloud'
      ? { kind: 'id', id: 'manual' }
      : { kind: 'bytes', id, bytes: await fetchBytes('/manual.pdf') };
  return { source, name: `Untitled ${untitledSeq}` };
}
