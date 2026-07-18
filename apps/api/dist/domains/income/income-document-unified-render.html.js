/**
 * Unified Income document HTML output — shared by preview and PDF.
 */
import { renderIncomeBrandedPreviewHtml, } from './income-document-branding-preview.renderer.js';
const HEBREW_FONT_LINK = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap';
export function renderUnifiedIncomeDocumentHtml(input) {
    return renderIncomeBrandedPreviewHtml(input);
}
export function wrapUnifiedIncomeDocumentHtmlForPrint(documentBodyHtml) {
    return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Income Document</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${HEBREW_FONT_LINK}" rel="stylesheet" />
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm 12mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: Heebo, Arial, Helvetica, "Segoe UI", sans-serif;
      width: 210mm;
      min-height: 297mm;
    }
    a { color: inherit; }
    .nx-doc { max-width: 100%; box-sizing: border-box; }
    .nx-doc * { box-sizing: border-box; }
    @media print {
      html, body { width: auto; min-height: 0; }
      .nx-doc__platform-link { text-decoration: none; }
    }
  </style>
</head>
<body>
${documentBodyHtml}
</body>
</html>`;
}
export function buildUnifiedIncomeDocumentPrintHtml(input) {
    return wrapUnifiedIncomeDocumentHtmlForPrint(renderUnifiedIncomeDocumentHtml(input));
}
