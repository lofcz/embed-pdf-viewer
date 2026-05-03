/**
 * The two durable ways to address an annotation across reads.
 *
 * `objectNumber` is the PDF indirect object number, returned by
 * `EPDFAnnot_GetObjectNumber(annotPtr)`. It is `> 0` for indirect objects
 * (the overwhelming common case) and `0` for direct objects (rare, legacy
 * PDFs). When the engine sees `0` it falls back to `nm` if present, or
 * promotes the annotation to a weak ref (`AnnotationRef.kind === 'index'`).
 *
 * `nm` is the value of the annotation's `/NM` entry. The v3 engine never
 * writes `/NM` on read — clients can opt into symbolic IDs by passing one to
 * `create()`, but reads never mutate the document.
 */
export type AnnotationStableId =
  | { kind: 'objectNumber'; value: number }
  | { kind: 'nm'; value: string };
