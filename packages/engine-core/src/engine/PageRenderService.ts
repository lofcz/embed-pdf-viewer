import { AbortablePromise } from '../promise/AbortablePromise';
import type {
  PageImageHandle,
  PageImageOptions,
  PageRenderOptions,
  PageRaster,
} from '../dto/PageRender';

export interface PageRenderService {
  image(options?: PageImageOptions): AbortablePromise<PageImageHandle>;
  raw(options?: PageRenderOptions): AbortablePromise<PageRaster>;
}
