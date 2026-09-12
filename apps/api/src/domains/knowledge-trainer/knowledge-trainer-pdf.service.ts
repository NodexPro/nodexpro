import { pageHasUsableEmbeddedText } from './knowledge-trainer.pure.js';

type PdfJsModule = {
  getDocument: (src: { data: Uint8Array; disableWorker?: boolean; useSystemFonts?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
    }>;
  };
};

let pdfJsLoader: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsLoader) {
    pdfJsLoader = import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJsModule>;
  }
  return pdfJsLoader;
}

export async function countPdfPages(bytes: Buffer): Promise<number> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  return pdf.numPages;
}

export async function extractEmbeddedPdfPageText(bytes: Buffer, pageNo: number): Promise<{
  text: string;
  extraction_method: 'embedded_text';
  status: 'extracted' | 'needs_ocr';
}> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  if (pageNo < 1 || pageNo > pdf.numPages) {
    throw new Error('Page is outside the document');
  }
  const page = await pdf.getPage(pageNo);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => (typeof item.str === 'string' ? item.str : ''))
    .join(' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return {
    text,
    extraction_method: 'embedded_text',
    status: pageHasUsableEmbeddedText(text) ? 'extracted' : 'needs_ocr',
  };
}
