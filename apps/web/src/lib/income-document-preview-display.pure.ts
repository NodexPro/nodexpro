/**
 * Presentation-only helpers for income document preview HTML rendered in the UI.
 * Does not change financial truth — display formatting only.
 */

const PREVIEW_DISCOUNT_ROW_AMOUNT_PATTERN =
  /(<div class="nx-doc__total-row nx-doc__total-row--discount"[^>]*>\s*<span>[^<]*<\/span>\s*<span>)\s*[−\-–—]+\s*/g;

/** Strip leading minus from discount amount in preview totals (label already indicates discount). */
export function normalizeIncomeDocumentPreviewHtml(html: string): string {
  if (!html.trim()) return html;
  return html.replace(PREVIEW_DISCOUNT_ROW_AMOUNT_PATTERN, '$1');
}
