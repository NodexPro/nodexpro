/**
 * Parent-controlled print for the issued-document viewer.
 * Uses already-rendered canonical HTML. Does not touch the sandboxed preview iframe.
 */

import { buildIncomePreviewScreenIframeSrcDoc } from '../work-engine/work-engine-income-document-preview-screen.pure';

export function printIncomeIssuedDocumentHtml(canonicalHtml: string): void {
  const body = typeof canonicalHtml === 'string' ? canonicalHtml.trim() : '';
  if (!body) return;
  const srcDoc = buildIncomePreviewScreenIframeSrcDoc(body);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(srcDoc);
  printWindow.document.close();
  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
  if (printWindow.document.readyState === 'complete') {
    window.setTimeout(triggerPrint, 50);
    return;
  }
  printWindow.addEventListener('load', triggerPrint, { once: true });
}
