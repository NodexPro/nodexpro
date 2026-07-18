/**
 * INC-6 — Backend PDF template resolver (Country-Pack-ready; IL fallback).
 */

import type { IncomeDocumentType } from './income.types.js';

export interface IncomePdfTemplateResolution {
  template_key: string;
  template_version: string;
  language: 'he' | 'en';
  rtl: boolean;
  country_code: string;
}

export const DOCUMENT_TYPE_LABELS_HE: Record<IncomeDocumentType, string> = {
  receipt: 'קבלה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס/קבלה',
  credit_tax_invoice: 'חשבונית מס זיכוי',
  deal_invoice: 'חשבון עסקה',
  quote: 'הצעת מחיר',
};

const DOCUMENT_TYPE_LABELS_EN: Record<IncomeDocumentType, string> = {
  receipt: 'Receipt',
  tax_invoice: 'Tax invoice',
  tax_invoice_receipt: 'Tax invoice / receipt',
  credit_tax_invoice: 'Credit tax invoice',
  deal_invoice: 'Deal invoice',
  quote: 'Quote',
};

export function documentTypeLabel(
  documentType: IncomeDocumentType,
  language: 'he' | 'en',
): string {
  return language === 'he' ? DOCUMENT_TYPE_LABELS_HE[documentType] : DOCUMENT_TYPE_LABELS_EN[documentType];
}

export function resolveIncomePdfTemplate(params: {
  document_type: IncomeDocumentType;
  language: string | null;
  country_code: string | null;
}): IncomePdfTemplateResolution {
  const language = params.language === 'en' ? 'en' : 'he';
  const country_code = String(params.country_code ?? 'IL').trim().toUpperCase() || 'IL';
  const typeSuffix = params.document_type.replace(/_/g, '-');

  return {
    template_key: `fallback_${country_code.toLowerCase()}_${typeSuffix}_v1`,
    template_version: '1',
    language,
    rtl: language === 'he',
    country_code,
  };
}

export function requiresPdfRender(documentType: IncomeDocumentType): boolean {
  return (
    documentType === 'receipt' ||
    documentType === 'tax_invoice' ||
    documentType === 'tax_invoice_receipt' ||
    documentType === 'credit_tax_invoice' ||
    documentType === 'deal_invoice' ||
    documentType === 'quote'
  );
}
