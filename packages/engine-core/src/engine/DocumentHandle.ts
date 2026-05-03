import { AbortablePromise } from '../promise/AbortablePromise';
import type { MetadataService } from './MetadataService';

export interface DocumentHandle {
  readonly id: string;
  readonly metadata: MetadataService;
  close(): AbortablePromise<void>;
}
