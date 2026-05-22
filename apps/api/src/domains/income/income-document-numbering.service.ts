/**
 * INC-4 / INC-8.5 — Backend-only income document numbering (IL series policy).
 */

import { supabaseAdmin } from '../../db/client.js';
import { badRequest } from '../../shared/errors.js';
import type { IncomeDocumentType } from './income.types.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import {
  computeNextIlSeriesNumber,
  formatIlSeriesDocumentNumber,
  IL_NUMBERING_POLICY_KEY,
  IL_NUMBERING_SERIES_YEAR,
  resolveIlSeriesPolicy,
} from './income-document-numbering-policy.js';

export interface AllocatedDocumentNumber {
  document_number: string;
  sequence_number: number;
  year: number;
}

const MAX_ALLOC_RETRIES = 8;

export async function allocateIncomeDocumentNumber(
  scope: ActiveIncomeIssuerScope,
  documentType: IncomeDocumentType,
  _issueDateIso: string,
  _prefix?: string | null,
): Promise<AllocatedDocumentNumber> {
  const policy = resolveIlSeriesPolicy(documentType);
  const year = IL_NUMBERING_SERIES_YEAR;

  for (let attempt = 0; attempt < MAX_ALLOC_RETRIES; attempt++) {
    let q = supabaseAdmin
      .from('income_document_numbering_sequences')
      .select('id, current_number, policy_key')
      .eq('organization_id', scope.org_id)
      .eq('issuer_business_id', scope.issuer_business_id)
      .eq('document_type', documentType)
      .eq('year', year);

    if (scope.represented_client_id) {
      q = q.eq('represented_client_id', scope.represented_client_id);
    } else {
      q = q.is('represented_client_id', null);
    }

    const { data: existing, error: readErr } = await q.maybeSingle();
    if (readErr) throw readErr;

    if (!existing) {
      const first = policy.first_number;
      const { error: insErr } = await supabaseAdmin.from('income_document_numbering_sequences').insert({
        organization_id: scope.org_id,
        issuer_business_id: scope.issuer_business_id,
        represented_client_id: scope.represented_client_id,
        document_type: documentType,
        year,
        current_number: first,
        prefix: null,
        policy_key: IL_NUMBERING_POLICY_KEY,
        range_start: policy.range_start,
        range_end: policy.range_end,
        overflow_next: policy.overflow_next,
      });
      if (insErr) {
        if (String(insErr.code) === '23505') continue;
        throw insErr;
      }
      return {
        document_number: formatIlSeriesDocumentNumber(first),
        sequence_number: first,
        year,
      };
    }

    const row = existing as { id: string; current_number: number };
    const { next_number } = computeNextIlSeriesNumber(row.current_number, policy);

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('income_document_numbering_sequences')
      .update({
        current_number: next_number,
        policy_key: IL_NUMBERING_POLICY_KEY,
        range_start: policy.range_start,
        range_end: policy.range_end,
        overflow_next: policy.overflow_next,
      })
      .eq('id', row.id)
      .eq('current_number', row.current_number)
      .select('current_number')
      .maybeSingle();

    if (updErr) throw updErr;
    if (updated) {
      return {
        document_number: formatIlSeriesDocumentNumber(next_number),
        sequence_number: next_number,
        year,
      };
    }
  }

  throw badRequest('Failed to allocate document number after retries');
}

/** Read-only preview of the next document number (does not allocate). */
export async function previewNextIncomeDocumentNumber(
  scope: ActiveIncomeIssuerScope,
  documentType: IncomeDocumentType,
): Promise<string | null> {
  const policy = resolveIlSeriesPolicy(documentType);
  const year = IL_NUMBERING_SERIES_YEAR;

  let q = supabaseAdmin
    .from('income_document_numbering_sequences')
    .select('current_number')
    .eq('organization_id', scope.org_id)
    .eq('issuer_business_id', scope.issuer_business_id)
    .eq('document_type', documentType)
    .eq('year', year);

  if (scope.represented_client_id) {
    q = q.eq('represented_client_id', scope.represented_client_id);
  } else {
    q = q.is('represented_client_id', null);
  }

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  const current = data ? Number((data as { current_number: number }).current_number) : 0;
  const { next_number } = computeNextIlSeriesNumber(current, policy);
  return formatIlSeriesDocumentNumber(next_number);
}
