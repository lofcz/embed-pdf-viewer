import { AbortablePromise } from '../promise/AbortablePromise';
import type { PageGeometrySnapshot } from '../dto/PageGeometrySnapshot';

export interface PageGeometryService {
  read(): AbortablePromise<PageGeometrySnapshot>;
}
