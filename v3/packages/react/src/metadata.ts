import { MetadataToken } from '@embedpdf-x/plugin-metadata';
import type { DocumentMetadata, MetadataPatch } from '@embedpdf-x/kernel';
import { useCapability, useSelector } from './runtime';

/**
 * The document's metadata, bound to the surrounding `DocumentScope`. Reactive:
 * `metadata` updates from your own edits AND from remote (SSE) edits — the
 * plugin keeps it live off the document event stream.
 *
 *   const { metadata, update } = useMetadata();
 *   await update({ title: 'New title' }); // three-state patch; writes to the layer
 */
export function useMetadata(): {
  metadata: DocumentMetadata | null;
  update: (patch: MetadataPatch) => Promise<void>;
  canEdit: () => boolean;
} {
  const cap = useCapability(MetadataToken);
  const metadata = useSelector(MetadataToken, (c) => c.current());
  return { metadata, update: cap.update, canEdit: cap.canEdit };
}
