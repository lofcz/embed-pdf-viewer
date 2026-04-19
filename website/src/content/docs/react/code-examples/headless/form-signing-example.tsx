'use client'

import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF } from '@embedpdf/core/react'
import {
  PdfSignatureHashAlgorithm,
  PdfSignatureSubFilter,
} from '@embedpdf/models'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import {
  AnnotationLayer,
  AnnotationPluginPackage,
  LockModeType,
} from '@embedpdf/plugin-annotation/react'
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react'
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react'
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react'
import {
  FormPluginPackage,
  useFormCapability,
} from '@embedpdf/plugin-form/react'
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react'
import { Scroller, ScrollPluginPackage } from '@embedpdf/plugin-scroll/react'
import {
  SelectionLayer,
  SelectionPluginPackage,
} from '@embedpdf/plugin-selection/react'
import {
  Viewport,
  ViewportPluginPackage,
} from '@embedpdf/plugin-viewport/react'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, {
    initialDocuments: [{ url: '/form-signature.pdf' }],
  }),
  createPluginRegistration(ViewportPluginPackage),
  createPluginRegistration(ScrollPluginPackage),
  createPluginRegistration(RenderPluginPackage),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(SelectionPluginPackage),
  createPluginRegistration(HistoryPluginPackage),
  createPluginRegistration(AnnotationPluginPackage, {
    locked: { type: LockModeType.Include, categories: ['form'] },
  }),
  createPluginRegistration(FormPluginPackage),
]

type SigningStatus = 'idle' | 'signing' | 'success' | 'error'

interface CmsResponse {
  cmsBase64: string
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

async function signDigestWithBackend(
  digest: ArrayBuffer,
  algorithm: PdfSignatureHashAlgorithm,
) {
  const response = await fetch('/api/examples/pdf-signing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      digestBase64: arrayBufferToBase64(digest),
      algorithm,
    }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string
    } | null

    throw new Error(payload?.error ?? 'Failed to create CMS signature.')
  }

  const payload = (await response.json()) as CmsResponse
  return base64ToArrayBuffer(payload.cmsBase64)
}

function triggerPdfDownload(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
}

const SigningSidebar = ({ documentId }: { documentId: string }) => {
  const { provides: formCapability } = useFormCapability()
  const downloadUrlRef = useRef<string | null>(null)
  const [status, setStatus] = useState<SigningStatus>('idle')
  const [message, setMessage] = useState(
    'Click an unsigned signature field in the PDF to start the signing flow.',
  )
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [lastSignedField, setLastSignedField] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!formCapability) return

    const scope = formCapability.forDocument(documentId)

    const unsubscribe = scope.onSignatureFieldRequest((request) => {
      void (async () => {
        const fieldName = request.annotation.field.name || request.annotationId

        setStatus('signing')
        setMessage(`Signing "${fieldName}" through the backend...`)

        try {
          const signedPdf = await request
            .sign({
              subFilter: PdfSignatureSubFilter.PKCS7_DETACHED,
              contentsSize: 16384,
              reason: 'Approved in the EmbedPDF documentation example',
              location: 'EmbedPDF Docs',
              contactInfo: 'docs@embedpdf.com',
              signer: {
                sign: (digest, algorithm) =>
                  signDigestWithBackend(digest, algorithm),
              },
            })
            .toPromise()

          if (downloadUrlRef.current) {
            URL.revokeObjectURL(downloadUrlRef.current)
          }

          const nextDownloadUrl = URL.createObjectURL(
            new Blob([signedPdf], { type: 'application/pdf' }),
          )

          downloadUrlRef.current = nextDownloadUrl
          setDownloadUrl(nextDownloadUrl)
          setLastSignedField(fieldName)
          setStatus('success')
          setMessage(
            `Signed "${fieldName}". The signed PDF was downloaded automatically.`,
          )
          triggerPdfDownload(nextDownloadUrl, 'signed-form.pdf')
        } catch (error) {
          setStatus('error')
          setMessage(
            error instanceof Error
              ? error.message
              : 'Signing failed unexpectedly.',
          )
        }
      })()
    })

    return unsubscribe
  }, [documentId, formCapability])

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950 lg:w-[320px] lg:border-l lg:border-t-0">
      <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Digital Signing
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Unsigned signature widgets become clickable in fill mode. The worker
          prepares the PDF, the backend creates the CMS signature, and the
          browser downloads the signed copy.
        </p>
      </div>

      <div className="space-y-4 p-4 text-sm">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-gray-700 dark:text-gray-200">
              Status
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                status === 'success'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : status === 'error'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : status === 'signing'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {status}
            </span>
          </div>

          <p className="mt-3 text-xs leading-5 text-gray-600 dark:text-gray-300">
            {message}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <h4 className="tracking-wide text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            What This Demo Does
          </h4>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-gray-600 dark:text-gray-300">
            <li>1. Click an unsigned signature field inside the PDF.</li>
            <li>2. `onSignatureFieldRequest` calls `request.sign(...)`.</li>
            <li>3. The backend returns a detached CMS/PKCS#7 signature.</li>
            <li>4. The signed PDF is downloaded as a new file.</li>
          </ul>
        </div>

        {downloadUrl && (
          <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Last signed field:{' '}
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {lastSignedField}
              </span>
            </p>
            <a
              href={downloadUrl}
              download="signed-form.pdf"
              className="mt-3 inline-flex rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Download signed PDF again
            </a>
          </div>
        )}
      </div>
    </aside>
  )
}

export const FormSigningViewer = () => {
  const { engine, isLoading } = usePdfiumEngine({
    wasmUrl: 'http://localhost:3020/pdfium.wasm',
  })

  if (isLoading || !engine) {
    return (
      <div className="overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="flex h-[420px] items-center justify-center">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading PDF Engine...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      {({ activeDocumentId }) =>
        activeDocumentId && (
          <DocumentContent documentId={activeDocumentId}>
            {({ isLoaded }) =>
              isLoaded && (
                <div
                  className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
                  style={{ userSelect: 'none' }}
                >
                  <div className="flex flex-col lg:h-[560px] lg:flex-row">
                    <div className="relative h-[420px] sm:h-[560px] lg:h-auto lg:flex-1">
                      <Viewport
                        documentId={activeDocumentId}
                        className="absolute inset-0 bg-gray-200 dark:bg-gray-800"
                      >
                        <Scroller
                          documentId={activeDocumentId}
                          renderPage={({ pageIndex }) => (
                            <PagePointerProvider
                              documentId={activeDocumentId}
                              pageIndex={pageIndex}
                            >
                              <RenderLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                                style={{ pointerEvents: 'none' }}
                              />
                              <SelectionLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                              />
                              <AnnotationLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                              />
                            </PagePointerProvider>
                          )}
                        />
                      </Viewport>
                    </div>

                    <SigningSidebar documentId={activeDocumentId} />
                  </div>
                </div>
              )
            }
          </DocumentContent>
        )
      }
    </EmbedPDF>
  )
}
