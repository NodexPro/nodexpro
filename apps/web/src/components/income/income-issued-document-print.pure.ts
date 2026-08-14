/**
 * Parent-controlled print for the issued-document viewer.
 * Wraps the SAME canonical HTML as the visible preview.
 * Does not reuse screen-fit iframe chrome. Does not touch the sandboxed preview iframe.
 */

const DOCUMENT_FONT = 'Heebo, Arial, Helvetica, sans-serif';
const PRINT_IFRAME_ATTR = 'data-income-issued-print-frame';

/**
 * Print-only wrapper around canonical issued HTML.
 * A4 portrait, 48px page inset (same as visible paper chrome), scale 1.
 * No 794px lock, no transform/fit, no Google Fonts @import, no min-height page pad.
 */
export function buildIncomeIssuedDocumentPrintSrcDoc(canonicalHtml: string): string {
  const body = typeof canonicalHtml === 'string' ? canonicalHtml.trim() : '';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>הדפסת מסמך</title>
  <style>
    @page { size: A4 portrait; margin: 48px; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 0;
      height: auto;
      overflow: visible;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-family: ${DOCUMENT_FONT};
    }
    a { color: inherit; }
    .nx-doc { max-width: 100%; box-sizing: border-box; }
    .nx-doc * { box-sizing: border-box; }
    @media print {
      html, body {
        width: 100%;
        height: auto;
        min-height: 0;
        overflow: visible;
      }
      .nx-doc { max-width: 100%; }
      .nx-doc__platform-link { text-decoration: none; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export function printIncomeIssuedDocumentHtml(canonicalHtml: string): void {
  const body = typeof canonicalHtml === 'string' ? canonicalHtml.trim() : '';
  if (!body || typeof document === 'undefined') return;

  document.querySelectorAll(`iframe[${PRINT_IFRAME_ATTR}]`).forEach((node) => node.remove());

  const iframe = document.createElement('iframe');
  iframe.setAttribute(PRINT_IFRAME_ATTR, 'true');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'הדפסת מסמך');
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');
  iframe.style.cssText =
    'position:fixed;left:-210mm;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;';

  let cleaned = false;
  let media: MediaQueryList | null = null;
  let iframeWin: Window | null = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      iframeWin?.removeEventListener('afterprint', onAfterPrint);
    } catch {
      /* ignore */
    }
    window.removeEventListener('afterprint', onAfterPrint);
    window.removeEventListener('focus', onFocus);
    if (media) {
      try {
        media.removeEventListener('change', onMediaChange);
      } catch {
        /* ignore */
      }
    }
    window.setTimeout(() => {
      iframe.remove();
      try {
        window.focus();
      } catch {
        /* ignore */
      }
    }, 0);
  };

  const onAfterPrint = () => cleanup();
  const onFocus = () => cleanup();
  const onMediaChange = (event: MediaQueryListEvent) => {
    if (!event.matches) cleanup();
  };

  iframe.addEventListener(
    'load',
    () => {
      iframeWin = iframe.contentWindow;
      if (!iframeWin) {
        cleanup();
        return;
      }
      iframeWin.addEventListener('afterprint', onAfterPrint);
      window.addEventListener('afterprint', onAfterPrint);
      try {
        media = window.matchMedia('print');
        media.addEventListener('change', onMediaChange);
      } catch {
        media = null;
      }
      try {
        iframeWin.focus();
        iframeWin.print();
      } catch {
        cleanup();
        return;
      }
      window.setTimeout(() => {
        if (!cleaned) window.addEventListener('focus', onFocus);
      }, 0);
    },
    { once: true },
  );

  iframe.srcdoc = buildIncomeIssuedDocumentPrintSrcDoc(body);
  document.body.appendChild(iframe);
}
