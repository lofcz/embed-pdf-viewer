import { PdfSignatureHashAlgorithm } from '@embedpdf/models'
import { Crypto } from '@peculiar/webcrypto'
import forge from 'node-forge'
import { NextRequest, NextResponse } from 'next/server'
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

export const runtime = 'nodejs'

const crypto = new Crypto()
pkijs.setEngine('webcrypto', new pkijs.CryptoEngine({ crypto }))

interface SignPdfRequestBody {
  digestBase64?: string
  algorithm?: PdfSignatureHashAlgorithm
}

interface SigningIdentity {
  certificate: forge.pki.Certificate
  privateKey: forge.pki.rsa.PrivateKey
}

const HASH_CONFIG: Record<
  PdfSignatureHashAlgorithm,
  {
    digestLength: number
    algorithmName: string
    oid: string
  }
> = {
  [PdfSignatureHashAlgorithm.SHA256]: {
    digestLength: 32,
    algorithmName: 'SHA-256',
    oid: '2.16.840.1.101.3.4.2.1',
  },
  [PdfSignatureHashAlgorithm.SHA384]: {
    digestLength: 48,
    algorithmName: 'SHA-384',
    oid: '2.16.840.1.101.3.4.2.2',
  },
  [PdfSignatureHashAlgorithm.SHA512]: {
    digestLength: 64,
    algorithmName: 'SHA-512',
    oid: '2.16.840.1.101.3.4.2.3',
  },
}

let cachedIdentity: SigningIdentity | null = null

function createSelfSignedIdentity(): SigningIdentity {
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })
  const certificate = forge.pki.createCertificate()
  const now = new Date()
  const serialNumber = `${Date.now().toString(16)}${Math.floor(
    Math.random() * 0xffff,
  )
    .toString(16)
    .padStart(4, '0')}`
  const subject = [
    { name: 'commonName', value: 'EmbedPDF Docs Signer' },
    { name: 'organizationName', value: 'EmbedPDF' },
    { shortName: 'OU', value: 'Documentation Example' },
  ]

  certificate.serialNumber = serialNumber
  certificate.publicKey = keyPair.publicKey
  certificate.validity.notBefore = new Date(now.getTime() - 60_000)
  certificate.validity.notAfter = new Date(
    now.getTime() + 365 * 24 * 60 * 60 * 1000,
  )
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
    },
    {
      name: 'extKeyUsage',
      emailProtection: true,
    },
    { name: 'subjectKeyIdentifier' },
  ])
  certificate.sign(keyPair.privateKey, forge.md.sha256.create())

  return {
    certificate,
    privateKey: keyPair.privateKey,
  }
}

function getSigningIdentity() {
  if (!cachedIdentity) {
    cachedIdentity = createSelfSignedIdentity()
  }

  return cachedIdentity
}

function base64ToBytes(base64: string) {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

function forgeCertToDer(cert: forge.pki.Certificate): ArrayBuffer {
  const asn1 = forge.pki.certificateToAsn1(cert)
  const der = forge.asn1.toDer(asn1).getBytes()
  return Uint8Array.from(der, (c) => c.charCodeAt(0)).buffer
}

function forgeKeyToPkcs8Der(key: forge.pki.rsa.PrivateKey): ArrayBuffer {
  const asn1 = forge.pki.privateKeyToAsn1(key)
  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(asn1)
  const der = forge.asn1.toDer(privateKeyInfo).getBytes()
  return Uint8Array.from(der, (c) => c.charCodeAt(0)).buffer
}

async function createDetachedCms(
  digestBytes: Uint8Array,
  algorithm: PdfSignatureHashAlgorithm,
): Promise<Buffer> {
  const hashConfig = HASH_CONFIG[algorithm]

  if (!hashConfig) {
    throw new Error('Unsupported signature digest algorithm.')
  }

  if (digestBytes.byteLength !== hashConfig.digestLength) {
    throw new Error('Digest length does not match the selected algorithm.')
  }

  const identity = getSigningIdentity()

  const certDer = forgeCertToDer(identity.certificate)
  const keyDer = forgeKeyToPkcs8Der(identity.privateKey)

  const pkijsCert = pkijs.Certificate.fromBER(certDer)

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: hashConfig.algorithmName },
    false,
    ['sign'],
  )

  const cmsSigned = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: '1.2.840.113549.1.7.1',
    }),
    certificates: [pkijsCert],
  })

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: pkijsCert.issuer,
      serialNumber: pkijsCert.serialNumber,
    }),
  })

  const signedAttrs = [
    new pkijs.Attribute({
      type: '1.2.840.113549.1.9.3',
      values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })],
    }),
    new pkijs.Attribute({
      type: '1.2.840.113549.1.9.5',
      values: [new asn1js.UTCTime({ valueDate: new Date() })],
    }),
    new pkijs.Attribute({
      type: '1.2.840.113549.1.9.4',
      values: [
        new asn1js.OctetString({
          valueHex: new Uint8Array(digestBytes).buffer as ArrayBuffer,
        }),
      ],
    }),
  ]

  signerInfo.signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: signedAttrs,
  })

  signerInfo.digestAlgorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: hashConfig.oid,
  })

  signerInfo.signatureAlgorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: '1.2.840.113549.1.1.1',
  })

  const signedAttrsSchema = signerInfo.signedAttrs.toSchema()
  // RFC 5652 section 5.4 requires re-encoding signedAttrs as a SET OF
  // for signature calculation instead of the final IMPLICIT [0] wrapper.
  signedAttrsSchema.idBlock.tagClass = 1
  signedAttrsSchema.idBlock.tagNumber = 17
  const signedAttrsDer = signedAttrsSchema.toBER(false)

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    signedAttrsDer,
  )

  signerInfo.signature = new asn1js.OctetString({ valueHex: signature })

  cmsSigned.signerInfos.push(signerInfo)

  cmsSigned.digestAlgorithms.push(
    new pkijs.AlgorithmIdentifier({ algorithmId: hashConfig.oid }),
  )

  const contentInfo = new pkijs.ContentInfo({
    contentType: '1.2.840.113549.1.7.2',
    content: cmsSigned.toSchema(true),
  })

  const cmsBytes = contentInfo.toSchema().toBER(false)
  return Buffer.from(cmsBytes)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SignPdfRequestBody

    if (!body.digestBase64) {
      return NextResponse.json(
        { error: '`digestBase64` is required.' },
        { status: 400 },
      )
    }

    const algorithm = body.algorithm ?? PdfSignatureHashAlgorithm.SHA256
    const digestBytes = base64ToBytes(body.digestBase64)
    const cms = await createDetachedCms(digestBytes, algorithm)

    return NextResponse.json({
      cmsBase64: cms.toString('base64'),
      certificatePem: forge.pki.certificateToPem(
        getSigningIdentity().certificate,
      ),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create detached CMS signature.',
      },
      { status: 500 },
    )
  }
}
