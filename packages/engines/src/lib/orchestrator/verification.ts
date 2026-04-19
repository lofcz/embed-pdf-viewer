import * as asn1js from 'asn1js';
import { PdfSignatureHashAlgorithm } from '@embedpdf/models';

const CMS_SIGNED_DATA_OID = '1.2.840.113549.1.7.2';
const CMS_MESSAGE_DIGEST_OID = '1.2.840.113549.1.9.4';

const DIGEST_ALGORITHM_OID_MAP: Record<string, PdfSignatureHashAlgorithm> = {
  '2.16.840.1.101.3.4.2.1': PdfSignatureHashAlgorithm.SHA256,
  '2.16.840.1.101.3.4.2.2': PdfSignatureHashAlgorithm.SHA384,
  '2.16.840.1.101.3.4.2.3': PdfSignatureHashAlgorithm.SHA512,
};

export interface CmsDigestInfo {
  algorithm: PdfSignatureHashAlgorithm;
  digest: Uint8Array;
}

function getChildArray(block: asn1js.BaseBlock<any>): asn1js.BaseBlock<any>[] {
  if (!('valueBlock' in block) || !('value' in block.valueBlock)) {
    return [];
  }
  const value = (block.valueBlock as { value?: asn1js.BaseBlock<any>[] }).value;
  return Array.isArray(value) ? value : [];
}

function readOid(block: asn1js.BaseBlock<any> | undefined): string | undefined {
  if (!(block instanceof asn1js.ObjectIdentifier)) {
    return undefined;
  }
  return block.valueBlock.toString();
}

function unwrapExplicitContext(
  block: asn1js.BaseBlock<any> | undefined,
): asn1js.BaseBlock<any> | undefined {
  if (!block || block.idBlock.tagClass !== 3) {
    return undefined;
  }
  return getChildArray(block)[0];
}

function readAlgorithmFromIdentifier(block: asn1js.BaseBlock<any> | undefined) {
  if (!block) {
    return undefined;
  }
  const oid = readOid(getChildArray(block)[0]);
  if (!oid) {
    return undefined;
  }
  return DIGEST_ALGORITHM_OID_MAP[oid];
}

export function extractDetachedCmsDigestInfo(cmsBlob: ArrayBuffer): CmsDigestInfo | undefined {
  const parsed = asn1js.fromBER(cmsBlob);
  if (parsed.offset === -1) {
    return undefined;
  }

  const contentInfoItems = getChildArray(parsed.result);
  if (readOid(contentInfoItems[0]) !== CMS_SIGNED_DATA_OID) {
    return undefined;
  }

  const signedData = unwrapExplicitContext(contentInfoItems[1]);
  const signedDataItems = signedData ? getChildArray(signedData) : [];
  if (signedDataItems.length === 0) {
    return undefined;
  }

  const signerInfos = signedDataItems[signedDataItems.length - 1];
  const signerInfo = getChildArray(signerInfos)[0];
  const signerInfoItems = signerInfo ? getChildArray(signerInfo) : [];
  if (signerInfoItems.length < 4) {
    return undefined;
  }

  const algorithm = readAlgorithmFromIdentifier(signerInfoItems[2]);
  if (algorithm === undefined) {
    return undefined;
  }

  const signedAttrs = signerInfoItems.find(
    (item) => item.idBlock.tagClass === 3 && item.idBlock.tagNumber === 0,
  );
  if (!signedAttrs) {
    return undefined;
  }

  for (const attr of getChildArray(signedAttrs)) {
    const attrItems = getChildArray(attr);
    if (readOid(attrItems[0]) !== CMS_MESSAGE_DIGEST_OID) {
      continue;
    }

    const attrValues = getChildArray(attrItems[1]);
    const digestValue = attrValues[0];
    if (!(digestValue instanceof asn1js.OctetString)) {
      return undefined;
    }

    return {
      algorithm,
      digest: new Uint8Array(digestValue.valueBlock.valueHexView.slice().buffer),
    };
  }

  return undefined;
}
