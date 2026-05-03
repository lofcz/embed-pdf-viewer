import { AbortablePromise } from '../promise/AbortablePromise';
import type { DocumentMetadata } from '../dto/DocumentMetadata';

export interface MetadataService {
  read(): AbortablePromise<DocumentMetadata>;
}
