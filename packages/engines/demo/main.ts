import { ConsoleLogger, ignore, PdfDocumentObject, PdfEngineError } from '@embedpdf/models';
import { PdfEngine, RemoteExecutor } from '../src/lib/orchestrator/public';
import { browserImageDataToBlobConverter } from '../src/lib/converters/browser';

async function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };

    reader.readAsArrayBuffer(file);
  });
}

function logError(error: PdfEngineError) {
  console.error(error);
}

async function run() {
  const logger = new ConsoleLogger();

  const worker = new Worker(new URL('./webworker.ts', import.meta.url), {
    type: 'module',
  });

  const executor = new RemoteExecutor(worker, {
    bootstrap: 'external',
    logger,
  });

  const engine = new PdfEngine<Blob>(executor, {
    imageConverter: browserImageDataToBlobConverter,
    logger,
  });

  const passwordElem = document.getElementById('pdf-password') as HTMLInputElement;
  const inputElem = document.getElementById('pdf-file') as HTMLInputElement;
  const saveElem = document.getElementById('save') as HTMLInputElement;

  let currDoc: PdfDocumentObject | null = null;
  inputElem?.addEventListener('input', async (evt) => {
    const closeTask = currDoc ? engine.closeDocument(currDoc) : null;
    currDoc = null;

    const proceed = async () => {
      const file = (evt.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const arrayBuffer = await readFile(file);
      const password = passwordElem.value;
      engine
        .openDocumentBuffer(
          { id: file.name, content: arrayBuffer },
          { password: password || undefined },
        )
        .wait(
          (doc) => {
            currDoc = doc;

            engine.getBookmarks(doc).wait((bookmarks) => {
              console.log(bookmarks);
            }, logError);

            for (let i = 0; i < doc.pageCount; i++) {
              const page = doc.pages[i];

              engine.renderPage(doc, page).wait((blob) => {
                const img = document.createElement('img');
                const rootElem = document.getElementById('root') as HTMLDivElement;
                rootElem.appendChild(img);
                img.style.width = `${page.size.width}px`;
                img.style.height = `${page.size.height}px`;
                img.src = URL.createObjectURL(blob);
              }, logError);

              engine.getPageAnnotations(doc, page).wait((annotations) => {
                console.log(page.index, annotations);
              }, logError);

              engine.getPageTextRects(doc, page).wait((textRects) => {
                console.log(page.index, textRects);
              }, logError);
            }
          },
          () => {
            currDoc = null;
          },
        );
    };

    if (closeTask) {
      closeTask.wait(proceed, logError);
    } else {
      proceed();
    }
  });

  saveElem.addEventListener('click', async () => {
    if (currDoc) {
      engine.saveAsCopy(currDoc).wait((buffer) => {
        const aElem = document.createElement('a');
        aElem.download = `copy-${Date.now()}.pdf`;
        aElem.href = URL.createObjectURL(new Blob([buffer]));
        aElem.click();
      }, ignore);
    }
  });
}

window.addEventListener('DOMContentLoaded', run);
