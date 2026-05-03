import { AbortablePromise } from '../promise/AbortablePromise';
import type { OpenInput, OpenOptions } from '../dto/OpenInput';
import type { DocumentHandle } from './DocumentHandle';

export interface Engine {
  open(input: OpenInput, options?: OpenOptions): AbortablePromise<DocumentHandle>;
  destroy(): AbortablePromise<void>;
}
