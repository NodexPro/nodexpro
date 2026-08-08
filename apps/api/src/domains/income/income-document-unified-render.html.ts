/**
 * Unified Income document HTML output — shared by preview and PDF.
 */

import {
  renderIncomeBrandedPreviewHtml,
  type IncomeBrandingPreviewLineRow,
  type IncomeBrandingPreviewParty,
  type IncomeBrandingPreviewTotals,
} from './income-document-branding-preview.renderer.js';
import type { UnifiedIncomeDocumentRenderInput } from './income-document-unified-render.pure.js';

export type { IncomeBrandingPreviewLineRow, IncomeBrandingPreviewParty, IncomeBrandingPreviewTotals };

const DOCUMENT_FONT = 'Heebo, Arial, Helvetica, sans-serif';

export function renderUnifiedIncomeDocumentHtml(input: UnifiedIncomeDocumentRenderInput): string {
  return renderIncomeBrandedPreviewHtml(input);
}

export function wrapUnifiedIncomeDocumentHtmlForPrint(documentBodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Income Document</title>
  <style>
    /* No external font CDN — production PDF render must not wait on networkidle/Google Fonts. */
    /*
     * Issued HTML viewer golden master = 794×1123 paper + 48px chrome inset.
     * Recreate that single inset here via @page. Puppeteer margins stay 0 (no double margin).
     */
    @page { size: A4 portrait; margin: 48px; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-family: ${DOCUMENT_FONT};
    }
    body {
      min-height: 297mm;
    }
    a { color: inherit; }
    .nx-doc { max-width: 100%; box-sizing: border-box; }
    .nx-doc * { box-sizing: border-box; }
    @media print {
      html, body { width: 100%; min-height: 0; }
      .nx-doc__platform-link { text-decoration: none; }
    }
  </style>
</head>
<body>
${documentBodyHtml}
</body>
</html>`;
}

export function buildUnifiedIncomeDocumentPrintHtml(input: UnifiedIncomeDocumentRenderInput): string {
  return wrapUnifiedIncomeDocumentHtmlForPrint(renderUnifiedIncomeDocumentHtml(input));
}
