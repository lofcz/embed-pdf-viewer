export const EngineErrorCode = {
  Unknown: 'Unknown',
  InvalidArg: 'InvalidArg',
  DocNotOpen: 'DocNotOpen',
  DocOpenFailed: 'DocOpenFailed',
  DocPasswordRequired: 'DocPasswordRequired',
  DocPasswordIncorrect: 'DocPasswordIncorrect',
  Aborted: 'Aborted',
  Network: 'Network',
  Unauthenticated: 'Unauthenticated',
  Forbidden: 'Forbidden',
  NotFound: 'NotFound',
  WireFormat: 'WireFormat',
  RuntimeUnavailable: 'RuntimeUnavailable',
  /**
   * Annotation/page reference could not be resolved. Surfaced when:
   *   - `AnnotationRef.kind === 'objectNumber'` but the document has no
   *     annotation with that indirect object number on the addressed page
   *   - `AnnotationRef.kind === 'nm'` but no annotation on the page has
   *     that `/NM`
   *   - `AnnotationRef.kind === 'index'` but the supplied `RevisionToken`
   *     does not match the current per-page generation
   *   - `AnnotationRef.kind === 'index'` but `index` is out of range for
   *     the page's current annotation count
   */
  InvalidReference: 'InvalidReference',
  /**
   * The requested operation is typed but not yet wired in this engine
   * version. The wire shape stays valid; clients can detect this with
   * `EngineError.is(err, EngineErrorCode.NotImplemented)` and degrade
   * gracefully.
   */
  NotImplemented: 'NotImplemented',
} as const;

export type EngineErrorCode = (typeof EngineErrorCode)[keyof typeof EngineErrorCode];
