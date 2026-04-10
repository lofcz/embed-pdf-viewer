/**
 * Public orchestrator entry point
 *
 * Client-side building blocks for composing a PdfEngine with a custom worker.
 *
 * @packageDocumentation
 */

export { PdfEngine } from './pdf-engine';
export type { PdfEngineOptions } from './pdf-engine';
export type { ImageDataConverter } from '../converters/types';
export type { ImageDataLike, IPdfiumExecutor, BatchProgress } from '@embedpdf/models';

export { RemoteExecutor } from './remote-executor';
export type { RemoteExecutorOptions, ManagedWorkerBootstrapOptions } from './remote-executor';
