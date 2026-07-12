/**
 * Tax allocation number (מספר הקצאה) — visibility/editability from Country Pack policy.
 * TEMPORARY_COUNTRY_PACK_PENDING: default policy until Owner Legal Control seed exists.
 */

import type { IncomeDocumentType } from './income.types.js';
import { INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER } from './income.types.js';

export const IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY =
  'il_income_tax_allocation_number_policy' as const;

/** Default applicable document types when Country Pack policy is not configured. */
const DEFAULT_APPLICABLE_TYPES: IncomeDocumentType[] = [
  'tax_invoice',
  'tax_invoice_receipt',
  'credit_tax_invoice',
];

const ALLOCATION_NUMBER_MAX_LEN = 64;
const ALLOCATION_NUMBER_PATTERN = /^[0-9]{1,64}$/;

export type IncomeTaxAllocationNumberPolicy = {
  applicable_document_types: IncomeDocumentType[];
  editable_after_issue: boolean;
  required_at_issue: boolean;
  empty_display: string | null;
};

export type IncomeDocumentAllocationNumberField = {
  visible: boolean;
  value: string | null;
  display_value: string;
  editable: boolean;
  disabled_reason: string | null;
  required: boolean;
  label: string;
  placeholder: string;
  command_name: typeof INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER;
  tooltip: string | null;
  confirmation_required: boolean;
  confirmation_title: string | null;
  confirmation_message: string | null;
};

export function defaultIncomeTaxAllocationNumberPolicy(): IncomeTaxAllocationNumberPolicy {
  return {
    applicable_document_types: [...DEFAULT_APPLICABLE_TYPES],
    editable_after_issue: false,
    required_at_issue: false,
    empty_display: null,
  };
}

export function parseIncomeTaxAllocationNumberPolicy(
  raw: unknown,
): IncomeTaxAllocationNumberPolicy {
  const defaults = defaultIncomeTaxAllocationNumberPolicy();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  const o = raw as Record<string, unknown>;
  const typesRaw = Array.isArray(o.applicable_document_types)
    ? o.applicable_document_types.filter((t): t is string => typeof t === 'string')
    : defaults.applicable_document_types;
  return {
    applicable_document_types: typesRaw as IncomeDocumentType[],
    editable_after_issue: o.editable_after_issue === true,
    required_at_issue: o.required_at_issue === true,
    empty_display:
      typeof o.empty_display === 'string' && o.empty_display.trim()
        ? o.empty_display.trim()
        : defaults.empty_display,
  };
}

export function normalizeAllocationNumberInput(raw: unknown): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
}

export function validateAllocationNumberFormat(value: string | null): string | null {
  if (value == null || !value.trim()) return null;
  const v = value.trim();
  if (v.length > ALLOCATION_NUMBER_MAX_LEN) {
    return `מספר הקצאה ארוך מדי (מקסימום ${ALLOCATION_NUMBER_MAX_LEN} תווים)`;
  }
  if (!ALLOCATION_NUMBER_PATTERN.test(v)) {
    return 'מספר הקצאה חייב להכיל ספרות בלבד';
  }
  return null;
}

export function isAllocationNumberApplicable(
  policy: IncomeTaxAllocationNumberPolicy,
  documentType: IncomeDocumentType | null | undefined,
): boolean {
  if (!documentType) return false;
  return policy.applicable_document_types.includes(documentType);
}

export function buildIncomeDocumentAllocationNumberField(params: {
  policy: IncomeTaxAllocationNumberPolicy;
  documentType: IncomeDocumentType | null | undefined;
  value: string | null;
  canEdit: boolean;
  isIssued: boolean;
}): IncomeDocumentAllocationNumberField {
  const visible = isAllocationNumberApplicable(params.policy, params.documentType);
  const normalized = normalizeAllocationNumberInput(params.value);
  const display =
    normalized ??
    (visible && params.policy.empty_display ? params.policy.empty_display : '—');

  let editable = params.canEdit && visible;
  let disabled_reason: string | null = null;

  if (!params.canEdit) {
    editable = false;
    disabled_reason = 'נדרשת הרשאת עריכה';
  } else if (params.isIssued && !params.policy.editable_after_issue) {
    editable = false;
    disabled_reason = 'לא ניתן לערוך לאחר הפקת המסמך';
  } else if (!visible) {
    editable = false;
    disabled_reason = null;
  }

  return {
    visible,
    value: normalized,
    display_value: display,
    editable,
    disabled_reason,
    required: visible && params.policy.required_at_issue,
    label: 'מספר הקצאה',
    placeholder: 'הזינו מספר הקצאה',
    command_name: INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER,
    tooltip: editable ? 'עריכת מספר הקצאה' : disabled_reason,
    confirmation_required: false,
    confirmation_title: null,
    confirmation_message: null,
  };
}

export function allocationNumberForDocumentRender(
  field: IncomeDocumentAllocationNumberField,
): { visible: boolean; display: string | null } {
  if (!field.visible) return { visible: false, display: null };
  return {
    visible: true,
    display: field.value?.trim() ? field.value.trim() : field.display_value,
  };
}
