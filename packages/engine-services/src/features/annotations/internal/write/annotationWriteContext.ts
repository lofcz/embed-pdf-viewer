/**
 * Optional capabilities threaded into per-subtype annotation writers.
 *
 * Today its only member is the registered-font resolver the FreeText writer
 * uses to turn a stable `registeredFontKey` into the current PDFium thread's
 * volatile `CFX_FontRegistry::FontId`. It is optional end-to-end: writers that
 * don't need it ignore the context, and a FreeText draft without a
 * `registeredFontKey` never touches the resolver.
 */
export interface AnnotationWriteContext {
  /**
   * Resolve a registered font key to this thread's native FontId. Throws if
   * the key was never registered on this thread. Absent when the host has no
   * font registry wired (e.g. read-only paths).
   */
  resolveRegisteredFontId?: (fontKey: string) => number;
}
