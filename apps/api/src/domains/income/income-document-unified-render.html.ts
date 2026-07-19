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

const HEBREW_FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap';

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
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${HEBREW_FONT_LINK}" rel="stylesheet" />
  <style>
    /* 10mm top / 12mm sides+bottom → 38/45px @96dpi (golden-master page contract) */
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

export function buildUnifiedIncomeDocumentPrintHtml(input: UnifiedIncomeDocumentRenderInput): string {
  return wrapUnifiedIncomeDocumentHtmlForPrint(renderUnifiedIncomeDocumentHtml(input));
}
