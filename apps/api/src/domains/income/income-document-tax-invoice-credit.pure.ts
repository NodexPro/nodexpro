/**
 * Tax invoice → credit_tax_invoice workflow (pure).
 * Financial amounts are composed from Accounting Base + issued credit lineage.
 * Does not invent numbering or VAT.
 */

import { roundMoney2 } from '../accounting-base/accounting-base-income-payment.pure.js';

export const INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT = 'begin_income_tax_invoice_credit' as const;
export const INCOME_CREDIT_DOCUMENT_TYPE = 'credit_tax_invoice' as const;
export const INCOME_CREDIT_SOURCE_SETTINGS_KEY = 'income_tax_invoice_credit' as const;
export const CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE =
  'CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE' as const;
export const CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE =
  'CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE' as const;

export type IncomeTaxInvoiceCreditMode = 'full' | 'partial';
export type IncomeTaxInvoiceCreditState = 'none' | 'partial' | 'full';

export type IncomeTaxInvoiceCreditReasonOption = {
  key: string;
  label: string;
};

export const INCOME_TAX_INVOICE_CREDIT_REASON_OPTIONS: IncomeTaxInvoiceCreditReasonOption[] = [
  { key: 'service_cancellation', label: 'ביטול שירות' },
  { key: 'pricing_correction', label: 'תיקון מחיר' },
  { key: 'returned_item', label: 'החזרת פריט / שירות' },
  { key: 'billing_error', label: 'טעות בחיוב' },
  { key: 'other', label: 'אחר' },
];

export type IncomeCreditSourceLineMapEntry = {
  source_line_identity: string;
  original_quantity: number;
  original_amount: number;
};

export type IncomeCreditDraftSettings = {
  source_invoice_id: string;
  source_invoice_number: string;
  credit_mode: IncomeTaxInvoiceCreditMode;
  reason_key: string;
  reason_note: string | null;
  locked_income_customer_id: string | null;
  locked_currency: string;
  line_map: Record<string, IncomeCreditSourceLineMapEntry>;
};

export function isIncomeTaxInvoiceCreditMode(value: unknown): value is IncomeTaxInvoiceCreditMode {
  return value === 'full' || value === 'partial';
}

export function parseIncomeTaxInvoiceCreditReasonKey(value: unknown): string {
  const key = String(value ?? '').trim();
  if (INCOME_TAX_INVOICE_CREDIT_REASON_OPTIONS.some((option) => option.key === key)) return key;
  return 'other';
}

export function creditReasonLabel(reasonKey: string): string {
  return (
    INCOME_TAX_INVOICE_CREDIT_REASON_OPTIONS.find((option) => option.key === reasonKey)?.label ??
    'אחר'
  );
}

export function sourceLineIdentityFromSnapshot(
  line: Record<string, unknown>,
  index: number,
): string {
  const id = String(line.line_id ?? '').trim();
  return id || `source_index:${index}`;
}

/**
 * Authoritative issued Credit Note amount = canonical Income totals/VAT grand total.
 * Never infer from source invoice total, source discount, remaining, or line reconstruction.
 */
export function resolveCanonicalCreditNoteAmount(
  totalsSnapshot: Record<string, unknown> | null | undefined,
): number {
  if (!totalsSnapshot || typeof totalsSnapshot !== 'object') return 0;
  const grand = totalsSnapshot.grand_total_reference;
  if (typeof grand === 'number' && Number.isFinite(grand) && grand > 0) {
    return roundMoney2(grand);
  }
  return 0;
}

/**
 * Credit draft starts with the normal Income editor.
 * Source invoice document-level discount is NOT reused as a Credit Note discount
 * (that would double-discount already-net amounts or confuse discount with credit amount).
 */
export function resolveCreditNoteDraftDocumentSettings(): {
  vat_mode: 'standard';
  amount_rounding: 'none';
  discount: { enabled: false; type: 'percent'; value: 0 };
} {
  return {
    vat_mode: 'standard',
    amount_rounding: 'none',
    discount: { enabled: false, type: 'percent', value: 0 },
  };
}

/**
 * Issued invoice lines are pre–document-discount amounts.
 * With Credit Note discount disabled, scale line money by source
 * (subtotal_after_discount / subtotal_before_discount) so a full Credit Note
 * seeds to the same net as the source invoice grand path — without re-applying discount.
 * Does not invent the Credit Note amount; accountant may still edit lines/VAT mode.
 */
export function applySourceDocumentDiscountNetToCreditDraftLines<
  T extends {
    amount_reference: number | null;
    unit_price_reference: number | null;
  },
>(params: {
  lines: T[];
  sourceTotalsSnapshot: Record<string, unknown> | null | undefined;
}): T[] {
  const totals = params.sourceTotalsSnapshot;
  if (!totals || typeof totals !== 'object' || totals.discount_enabled !== true) {
    return params.lines;
  }
  const before = Number(totals.subtotal_before_discount_reference);
  const after = Number(totals.subtotal_after_discount_reference);
  if (!(before > 0) || !Number.isFinite(after) || after < 0) return params.lines;
  const factor = after / before;
  if (!(factor > 0) || factor > 1.0001) return params.lines;
  if (Math.abs(factor - 1) < 0.0000001) return params.lines;
  return params.lines.map((line) => {
    const amount = line.amount_reference;
    const unit = line.unit_price_reference;
    return {
      ...line,
      amount_reference:
        typeof amount === 'number' && Number.isFinite(amount) ? roundMoney2(amount * factor) : amount,
      unit_price_reference:
        typeof unit === 'number' && Number.isFinite(unit) ? roundMoney2(unit * factor) : unit,
    };
  });
}

export function resolveCreditState(params: {
  originalAmount: number;
  creditedAmount: number;
}): {
  credit_state: IncomeTaxInvoiceCreditState;
  remaining_creditable_amount: number;
} {
  const original = roundMoney2(Math.max(0, params.originalAmount));
  const credited = roundMoney2(Math.max(0, params.creditedAmount));
  const remaining = roundMoney2(Math.max(0, original - credited));
  if (credited <= 0) return { credit_state: 'none', remaining_creditable_amount: remaining };
  if (remaining <= 0.005) return { credit_state: 'full', remaining_creditable_amount: 0 };
  return { credit_state: 'partial', remaining_creditable_amount: remaining };
}

export function resolveReceivableAfterCredit(params: {
  originalAmount: number;
  creditedAmount: number;
  allocatedPayments: number;
}): {
  net_invoice_amount: number;
  remaining_receivable: number;
  customer_credit: number;
} {
  const original = roundMoney2(Math.max(0, params.originalAmount));
  const credited = roundMoney2(Math.max(0, params.creditedAmount));
  const paid = roundMoney2(Math.max(0, params.allocatedPayments));
  const net = roundMoney2(Math.max(0, original - credited));
  return {
    net_invoice_amount: net,
    remaining_receivable: roundMoney2(Math.max(0, net - paid)),
    customer_credit: roundMoney2(Math.max(0, paid - net)),
  };
}

export function creditSourceReferenceDisplay(sourceInvoiceNumber: string): string {
  const number = String(sourceInvoiceNumber ?? '').trim();
  if (!number) return 'זיכוי עבור חשבונית מס';
  return `זיכוי עבור חשבונית מס מספר ${number}`;
}

export function mergeCreditSourceReferenceIntoNotes(
  notes: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  const ref = String(reference ?? '').trim();
  const base = String(notes ?? '').trim();
  if (!ref) return notes != null && String(notes).trim() ? String(notes) : null;
  if (base.includes(ref)) return notes != null && String(notes).trim() ? String(notes) : ref;
  return base ? `${base}\n${ref}` : ref;
}

export function composeCollectibleAfterCredit(params: {
  originalAmount: number;
  creditedAmount: number;
  allocatedPayments: number;
}): {
  net_invoice_amount: number;
  remaining_receivable: number;
  customer_credit: number;
  payment_state_key: 'unpaid' | 'partial' | 'paid';
  payment_state_label: string;
  payment_state_tone: 'danger' | 'warning' | 'success';
} {
  const after = resolveReceivableAfterCredit(params);
  if (after.remaining_receivable <= 0.005) {
    return {
      ...after,
      remaining_receivable: 0,
      payment_state_key: 'paid',
      payment_state_label: after.customer_credit > 0.005 ? 'שולם / יתרת זכות' : 'שולם',
      payment_state_tone: 'success',
    };
  }
  if (params.allocatedPayments > 0.005) {
    return {
      ...after,
      payment_state_key: 'partial',
      payment_state_label: 'שולם חלקית',
      payment_state_tone: 'warning',
    };
  }
  return {
    ...after,
    payment_state_key: 'unpaid',
    payment_state_label: 'לא שולם',
    payment_state_tone: 'danger',
  };
}

export function readCreditDraftSettings(
  documentSettingsJson: unknown,
): IncomeCreditDraftSettings | null {
  if (!documentSettingsJson || typeof documentSettingsJson !== 'object' || Array.isArray(documentSettingsJson)) {
    return null;
  }
  const raw = (documentSettingsJson as Record<string, unknown>)[INCOME_CREDIT_SOURCE_SETTINGS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const source_invoice_id = String(o.source_invoice_id ?? '').trim();
  if (!source_invoice_id) return null;
  const line_map: Record<string, IncomeCreditSourceLineMapEntry> = {};
  const rawMap = o.line_map;
  if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
    for (const [draftLineId, entry] of Object.entries(rawMap as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const source_line_identity = String(e.source_line_identity ?? '').trim();
      if (!source_line_identity) continue;
      line_map[draftLineId] = {
        source_line_identity,
        original_quantity: Number(e.original_quantity) || 0,
        original_amount: Number(e.original_amount) || 0,
      };
    }
  }
  return {
    source_invoice_id,
    source_invoice_number: String(o.source_invoice_number ?? '').trim(),
    credit_mode: isIncomeTaxInvoiceCreditMode(o.credit_mode) ? o.credit_mode : 'partial',
    reason_key: parseIncomeTaxInvoiceCreditReasonKey(o.reason_key),
    reason_note: o.reason_note != null && String(o.reason_note).trim() ? String(o.reason_note).trim() : null,
    locked_income_customer_id:
      o.locked_income_customer_id != null && String(o.locked_income_customer_id).trim()
        ? String(o.locked_income_customer_id).trim()
        : null,
    locked_currency: String(o.locked_currency ?? 'ILS').trim() || 'ILS',
    line_map,
  };
}

export function writeCreditDraftSettings(
  documentSettingsJson: Record<string, unknown> | null | undefined,
  settings: IncomeCreditDraftSettings,
): Record<string, unknown> {
  return {
    ...(documentSettingsJson ?? {}),
    [INCOME_CREDIT_SOURCE_SETTINGS_KEY]: settings,
  };
}

/**
 * SYSTEM-OWNED: income_tax_invoice_credit must survive ordinary draft settings rewrites
 * (discount / VAT / rounding / due-date). Never trust a client-supplied credit block.
 *
 * - If existing draft has lineage → always restore the existing raw block onto next settings.
 * - If client payload includes income_tax_invoice_credit → strip it (cannot invent/overwrite).
 * - Non-credit drafts (no existing block) → unchanged editable settings only.
 */
export function preserveIncomeTaxInvoiceCreditInDocumentSettings(
  existingDocumentSettingsJson: unknown,
  nextSettingsJson: Record<string, unknown>,
): Record<string, unknown> {
  const nextWithoutClientCredit: Record<string, unknown> = { ...nextSettingsJson };
  delete nextWithoutClientCredit[INCOME_CREDIT_SOURCE_SETTINGS_KEY];

  if (
    !existingDocumentSettingsJson ||
    typeof existingDocumentSettingsJson !== 'object' ||
    Array.isArray(existingDocumentSettingsJson)
  ) {
    return nextWithoutClientCredit;
  }

  const existingRaw = (existingDocumentSettingsJson as Record<string, unknown>)[
    INCOME_CREDIT_SOURCE_SETTINGS_KEY
  ];
  if (existingRaw === undefined) {
    return nextWithoutClientCredit;
  }

  return {
    ...nextWithoutClientCredit,
    [INCOME_CREDIT_SOURCE_SETTINGS_KEY]: existingRaw,
  };
}

export type CreditConsumeLineRequest = {
  source_line_identity: string;
  quantity: number;
  amount: number;
};

export function creditConsumeLinesFromDraft(params: {
  draftLinesJson: unknown;
  lineMap: Record<string, IncomeCreditSourceLineMapEntry>;
}): CreditConsumeLineRequest[] {
  const lines = Array.isArray(params.draftLinesJson) ? params.draftLinesJson : [];
  const requestedBySource = new Map<string, CreditConsumeLineRequest>();
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const draftLineId = String(o.line_id ?? '').trim();
    const mapped = params.lineMap[draftLineId];
    if (!mapped) {
      const err = new Error('שורת זיכוי אינה קשורה לשורת המקור');
      (err as Error & { code?: string }).code = CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE;
      throw err;
    }
    const qty = Number(o.quantity);
    const amount = Number(o.amount_reference ?? o.amount);
    const current = requestedBySource.get(mapped.source_line_identity) ?? {
      source_line_identity: mapped.source_line_identity,
      quantity: 0,
      amount: 0,
    };
    requestedBySource.set(mapped.source_line_identity, {
      source_line_identity: mapped.source_line_identity,
      quantity: current.quantity + (Number.isFinite(qty) ? qty : 0),
      amount: roundMoney2(current.amount + (Number.isFinite(amount) ? amount : 0)),
    });
  }
  return [...requestedBySource.values()];
}

export function decideAtomicCreditConsume(params: {
  originalAmount: number;
  creditedAmount: number;
  requestedAmount: number;
  lines?: Array<{
    remainingQuantity: number;
    remainingAmount: number;
    requestedQuantity: number;
    requestedAmount: number;
  }>;
}): { ok: true; nextCredited: number } | { ok: false; code: string } {
  try {
    assertCreditAmountWithinRemaining({
      requestedAmount: params.requestedAmount,
      remainingAmount: roundMoney2(Math.max(0, params.originalAmount - params.creditedAmount)),
    });
  } catch (e) {
    return {
      ok: false,
      code: (e as Error & { code?: string }).code ?? CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE,
    };
  }
  for (const line of params.lines ?? []) {
    if (
      line.requestedQuantity - line.remainingQuantity > 0.0009 ||
      line.requestedAmount - line.remainingAmount > 0.005
    ) {
      return { ok: false, code: CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE };
    }
  }
  return { ok: true, nextCredited: roundMoney2(params.creditedAmount + params.requestedAmount) };
}

export function assertCreditAmountWithinRemaining(params: {
  requestedAmount: number;
  remainingAmount: number;
}): void {
  const requested = roundMoney2(Math.max(0, params.requestedAmount));
  const remaining = roundMoney2(Math.max(0, params.remainingAmount));
  if (requested - remaining > 0.005) {
    const err = new Error('סכום הזיכוי חורג מהיתרה הניתנת לזיכוי');
    (err as Error & { code?: string }).code = CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE;
    throw err;
  }
}
