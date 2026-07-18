/**
 * Sectioned document-identity presentation (title + number bar).
 * Widths are prepared template values — no DOM measurement, no frontend switches.
 */

import type { IncomeDocumentType } from './income.types.js';
import { DOCUMENT_TYPE_LABELS_HE } from './income-pdf-template.resolver.js';
import { formatDocumentNumberDisplay } from './income-document-branding.pure.js';

/** Fallback = חשבונית מס width. */
export const SECTIONED_NUMBER_BAR_FALLBACK_WIDTH = '152px';

/**
 * Precomputed number-bar widths aligned to title glyph width at sectioned title size (26px / 800).
 * Keys are IncomeDocumentType; unknown titles fall back to tax_invoice.
 */
export const SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE: Record<IncomeDocumentType, string> = {
  tax_invoice: '152px',
  quote: '138px',
  deal_invoice: '148px',
  receipt: '78px',
  tax_invoice_receipt: '198px',
  credit_tax_invoice: '188px',
};

export type SectionedDocumentIdentityPresentation = {
  title: string;
  document_number: string;
  title_width_key: string;
  number_bar_width: string;
};

function widthForDocumentType(documentType: IncomeDocumentType | null | undefined): {
  title_width_key: string;
  number_bar_width: string;
} {
  if (documentType && documentType in SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE) {
    return {
      title_width_key: documentType,
      number_bar_width: SECTIONED_NUMBER_BAR_WIDTH_BY_DOC_TYPE[documentType],
    };
  }
  return {
    title_width_key: 'tax_invoice',
    number_bar_width: SECTIONED_NUMBER_BAR_FALLBACK_WIDTH,
  };
}

/** Resolve by backend document_type key; label used only as last-resort reverse lookup. */
export function resolveSectionedDocumentIdentityPresentation(params: {
  doc_type_label: string;
  document_number: string | null | undefined;
  document_type?: IncomeDocumentType | null;
}): SectionedDocumentIdentityPresentation {
  let documentType = params.document_type ?? null;
  if (!documentType && params.doc_type_label?.trim()) {
    const label = params.doc_type_label.trim();
    const entry = (Object.entries(DOCUMENT_TYPE_LABELS_HE) as [IncomeDocumentType, string][]).find(
      ([, he]) => he === label,
    );
    documentType = entry?.[0] ?? null;
  }
  const { title_width_key, number_bar_width } = widthForDocumentType(documentType);
  return {
    title: params.doc_type_label,
    document_number: formatDocumentNumberDisplay(params.document_number),
    title_width_key,
    number_bar_width,
  };
}
