/**
 * The one place the engine is chosen. Local PDFium-wasm in a worker; the rest
 * of the app only speaks the engine-core `Engine` contract.
 *
 * `createDeferredEngine()` returns a synchronously-usable facade and kicks the
 * real boot (wasm worker, fonts) off in the background — so the translated
 * chrome renders at t≈0 and only `documents.open()` awaits the engine.
 */
import { deferredEngine } from '@embedpdf-x/kernel';
import type { Engine, OpenInput } from '@embedpdf-x/kernel';
import type { InitialDocument } from '@embedpdf-x/react';

const DROID_FALLBACK_FONT = {
  key: 'droid-sans-fallback-full',
  familyName: 'Droid Sans Fallback',
  url: `${import.meta.env.BASE_URL}DroidSansFallbackFull.ttf`,
} as const;

export async function createEngine(): Promise<Engine> {
  const { createLocalEngineWithWorker } = await import('@embedpdf/engine');
  const { default: EngineWorker } = await import('@embedpdf/engine/worker-entry?worker');
  const engine = await createLocalEngineWithWorker({ worker: new EngineWorker() });
  await registerFallbackFonts(engine);
  return engine;
}

export function createDeferredEngine(): Engine {
  const booting = createEngine();
  return deferredEngine(() => booting);
}

async function registerFallbackFonts(engine: Engine): Promise<void> {
  if (!engine.fonts) return;
  try {
    const data = await fetchBytes(DROID_FALLBACK_FONT.url);
    const handle = await engine.fonts.register({
      key: DROID_FALLBACK_FONT.key,
      familyName: DROID_FALLBACK_FONT.familyName,
      data,
    });
    await engine.fonts.addFallback(handle);
  } catch (error) {
    console.warn('[snippet-react] fallback font not registered:', error);
  }
}

export const SAMPLES: ReadonlyArray<{ id: string; name: string; url: string }> = [
  { id: 'ebook', name: 'Ebook', url: '/ebook.pdf' },
  { id: 'report', name: 'Whitepaper', url: '/report.pdf' },
  { id: 'form-sample', name: 'Form', url: '/form-sample.pdf' },
];

export const fetchBytes = async (url: string): Promise<Uint8Array> =>
  fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });

export async function loadInitialDocuments(): Promise<InitialDocument[]> {
  return Promise.all(
    SAMPLES.map(async ({ id, name, url }) => ({
      source: { kind: 'bytes', id, bytes: await fetchBytes(url) } as OpenInput,
      name,
    })),
  );
}
