import { badRequest } from '../../shared/errors.js';
import { optionalJsonObject, optionalString } from './income.guards.js';
import { normalizeDraftLines } from './income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
} from './income-document-draft-totals.pure.js';
import { incomeDraftVatFallbackResolution } from './income-draft-vat-fallback.pure.js';
import type { IncomeAvailableDocumentType, IncomeDocumentType } from './income.types.js';

export interface ParsedDraftPayload {
  document_type: IncomeDocumentType | null;
  income_customer_id: string | null;
  one_time_customer_snapshot_json: Record<string, unknown> | null;
  draft_lines_json: unknown[];
  payment_terms_json: Record<string, unknown> | null;
  due_date: string | null;
  document_date: string | null;
  payment_received_json: Record<string, unknown> | null;
  notes: string | null;
  currency: string;
  language: string;
  document_settings_json?: unknown;
}

function parseOptionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw badRequest(`${field} must be YYYY-MM-DD`);
  }
  return s;
}

function parseLanguage(value: unknown): string {
  const lang = optionalString(value) ?? 'he';
  if (lang !== 'he' && lang !== 'en') throw badRequest('language must be he or en');
  return lang;
}

export function parseDraftPayloadBody(
  body: Record<string, unknown>,
  parseDocumentType: (value: unknown) => IncomeDocumentType | null,
  optionalUuid: (value: unknown, field: string) => string | null,
  reqJsonArray: (value: unknown, field: string) => unknown[],
): ParsedDraftPayload {
  const income_customer_id = optionalUuid(body.income_customer_id, 'income_customer_id');
  const one_time_customer_snapshot_json = optionalJsonObject(
    body.one_time_customer_snapshot_json,
    'one_time_customer_snapshot_json',
  );
  if (income_customer_id && one_time_customer_snapshot_json) {
    throw badRequest('one_time_customer_snapshot_json is only allowed when income_customer_id is null');
  }

  return {
    document_type: parseDocumentType(body.document_type),
    income_customer_id,
    one_time_customer_snapshot_json,
    draft_lines_json: reqJsonArray(body.draft_lines_json, 'draft_lines_json'),
    payment_terms_json: optionalJsonObject(body.payment_terms_json, 'payment_terms_json'),
    due_date: parseOptionalDate(body.due_date, 'due_date'),
    document_date: parseOptionalDate(body.document_date ?? body.issue_date, 'document_date'),
    payment_received_json: optionalJsonObject(body.payment_received_json, 'payment_received_json'),
    notes: optionalString(body.notes),
    currency: optionalString(body.currency) ?? 'ILS',
    language: parseLanguage(body.language),
  };
}

export function validateDraftAgainstDocumentTypeRules(
  payload: ParsedDraftPayload,
  docType: IncomeAvailableDocumentType,
): { validation_warnings_json: Record<string, unknown>[]; draft_totals_preview_json: Record<string, unknown> } {
  const warnings: Record<string, unknown>[] = [];

  if (docType.requires_payment_received && !payload.payment_received_json) {
    warnings.push({
      code: 'payment_received_recommended',
      message: 'Payment received details are expected for this document type.',
    });
  }
  if (docType.requires_due_date && !payload.due_date) {
    warnings.push({
      code: 'due_date_recommended',
      message: 'Due date is expected for this document type.',
    });
  }
  if (!payload.income_customer_id && !payload.one_time_customer_snapshot_json) {
    warnings.push({
      code: 'customer_required',
      message: 'Select an income customer or provide a one-time customer snapshot.',
    });
  }

  const lines = normalizeDraftLines(payload.draft_lines_json);
  const settings = parseDocumentSettingsJson(payload.document_settings_json ?? null);
  const totals = computeDraftTotalsPreview(lines, payload.currency, settings, incomeDraftVatFallbackResolution());

  return {
    validation_warnings_json: warnings,
    draft_totals_preview_json: totals,
  };
}
