import { PdfSignatureHashAlgorithm, PreparedSignatureData } from '@embedpdf/models';

/**
 * A pair of byte ranges: [offset1, length1, offset2, length2]
 * representing the two regions of the PDF that are hashed
 * (everything except the /Contents hex value).
 */
export type ByteRanges = [number, number, number, number];

const HASH_ALGORITHM_MAP: Record<PdfSignatureHashAlgorithm, string> = {
  [PdfSignatureHashAlgorithm.SHA256]: 'SHA-256',
  [PdfSignatureHashAlgorithm.SHA384]: 'SHA-384',
  [PdfSignatureHashAlgorithm.SHA512]: 'SHA-512',
};

/**
 * Validate that a PreparedSignatureData has sane offsets.
 * Throws if offsets are out of bounds or overlap incorrectly.
 */
export function validatePreparedSignature(data: PreparedSignatureData): void {
  const { buffer, contentsOffset, contentsLength, byteRangeOffset, byteRangeLength } = data;
  const len = buffer.byteLength;

  if (contentsOffset < 0 || contentsOffset + contentsLength > len) {
    throw new Error(
      `Contents placeholder out of bounds: offset=${contentsOffset}, length=${contentsLength}, fileSize=${len}`,
    );
  }
  if (byteRangeOffset < 0 || byteRangeOffset + byteRangeLength > len) {
    throw new Error(
      `ByteRange placeholder out of bounds: offset=${byteRangeOffset}, length=${byteRangeLength}, fileSize=${len}`,
    );
  }
}

/**
 * Compute the two byte ranges that cover the entire file
 * except the /Contents hex value.
 *
 * The PDF signature covers:
 *   Range 1: [0 .. contentsOffset - 1]  (before the hex string)
 *   Range 2: [contentsOffset + contentsLength .. EOF]  (after the hex string)
 */
export function computeByteRanges(
  bufferLength: number,
  contentsOffset: number,
  contentsLength: number,
): ByteRanges {
  const range1Start = 0;
  const range1Length = contentsOffset - 1; // -1 to exclude the '<' delimiter
  const range2Start = contentsOffset + contentsLength + 1; // +1 to skip the '>' delimiter
  const range2Length = bufferLength - range2Start;

  return [range1Start, range1Length, range2Start, range2Length];
}

/**
 * Patch the /ByteRange array in-place with actual values.
 * The sentinel values (2147483647) are replaced with the real
 * byte range numbers, space-padded to maintain the same total width.
 */
export function patchByteRange(
  buffer: ArrayBuffer,
  byteRangeOffset: number,
  byteRangeLength: number,
  ranges: ByteRanges,
): void {
  const [r1Start, r1Len, r2Start, r2Len] = ranges;
  const rangeStr = `${r1Start} ${r1Len} ${r2Start} ${r2Len}`;

  if (rangeStr.length > byteRangeLength) {
    throw new Error(
      `ByteRange string "${rangeStr}" (${rangeStr.length} chars) exceeds placeholder (${byteRangeLength} chars)`,
    );
  }

  const padded = rangeStr.padEnd(byteRangeLength, ' ');
  const view = new Uint8Array(buffer);
  for (let i = 0; i < padded.length; i++) {
    view[byteRangeOffset + i] = padded.charCodeAt(i);
  }
}

/**
 * Hash the two byte ranges of the PDF using WebCrypto.
 * The digest covers everything except the /Contents hex value.
 */
export async function hashByteRanges(
  buffer: ArrayBuffer,
  ranges: ByteRanges,
  algorithm: PdfSignatureHashAlgorithm,
): Promise<ArrayBuffer> {
  const [r1Start, r1Len, r2Start, r2Len] = ranges;
  const algoName = HASH_ALGORITHM_MAP[algorithm];
  if (!algoName) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  const part1 = new Uint8Array(buffer, r1Start, r1Len);
  const part2 = new Uint8Array(buffer, r2Start, r2Len);

  const combined = new Uint8Array(r1Len + r2Len);
  combined.set(part1, 0);
  combined.set(part2, r1Len);

  return crypto.subtle.digest(algoName, combined);
}

/**
 * Hex-encode a CMS/PKCS#7 DER blob and patch it into the
 * /Contents placeholder in-place.
 */
export function patchContents(
  buffer: ArrayBuffer,
  contentsOffset: number,
  contentsLength: number,
  cmsBlob: ArrayBuffer,
): void {
  const blobBytes = new Uint8Array(cmsBlob);
  const hexLen = blobBytes.length * 2;

  if (hexLen > contentsLength) {
    throw new Error(
      `CMS blob hex-encoded length (${hexLen}) exceeds Contents placeholder (${contentsLength}). ` +
        `Increase contentsSize to at least ${blobBytes.length}.`,
    );
  }

  const view = new Uint8Array(buffer);
  const hexChars = '0123456789abcdef';
  let pos = contentsOffset;

  for (let i = 0; i < blobBytes.length; i++) {
    view[pos++] = hexChars.charCodeAt((blobBytes[i] >> 4) & 0x0f);
    view[pos++] = hexChars.charCodeAt(blobBytes[i] & 0x0f);
  }

  while (pos < contentsOffset + contentsLength) {
    view[pos++] = 0x30; // '0'
  }
}
