/**
 * Lease-based idempotency for issue_and_send_income_document.
 */

import { supabaseAdmin } from '../../db/client.js';
import { badRequest, conflict } from '../../shared/errors.js';
import { INCOME_COMMAND_ISSUE_AND_SEND_DOCUMENT } from './income.types.js';

export type IncomeIssueAndSendIdempotencyLease =
  | { kind: 'fresh'; leaseRowId: string }
  | { kind: 'replay'; incomeDocumentId: string };

function normalizeIdempotencyKey(raw: unknown): string | null {
  if (raw == null) return null;
  const k = String(raw).trim();
  if (!k) return null;
  if (k.length > 256) throw badRequest('idempotency_key too long', 'idempotency_key_too_long');
  return k;
}

export function parseIssueAndSendIdempotencyKey(body: Record<string, unknown>): string {
  const key = normalizeIdempotencyKey(body.idempotency_key);
  if (!key) throw badRequest('idempotency_key is required');
  return key;
}

export async function beginIncomeIssueAndSendIdempotency(args: {
  organizationId: string;
  idempotencyKey: string;
  sourceDraftId: string;
}): Promise<IncomeIssueAndSendIdempotencyLease> {
  const { organizationId, idempotencyKey, sourceDraftId } = args;
  const insertResp = await supabaseAdmin
    .from('income_command_idempotency')
    .insert({
      organization_id: organizationId,
      idempotency_key: idempotencyKey,
      command_type: INCOME_COMMAND_ISSUE_AND_SEND_DOCUMENT,
      source_draft_id: sourceDraftId,
    })
    .select('id')
    .maybeSingle();

  if (!insertResp.error && insertResp.data?.id) {
    return { kind: 'fresh', leaseRowId: String(insertResp.data.id) };
  }

  const code = (insertResp.error as { code?: string } | undefined)?.code;
  if (code !== '23505') {
    if (insertResp.error) throw insertResp.error;
    throw badRequest('Idempotency insert failed', 'idempotency_insert_failed');
  }

  const { data: existing, error: selErr } = await supabaseAdmin
    .from('income_command_idempotency')
    .select('command_type, completed_at, income_document_id')
    .eq('organization_id', organizationId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (selErr) throw selErr;

  const row = existing as {
    command_type: string;
    completed_at: string | null;
    income_document_id: string | null;
  } | null;
  if (!row) throw insertResp.error ?? badRequest('Idempotency conflict', 'idempotency_conflict');

  if (row.command_type !== INCOME_COMMAND_ISSUE_AND_SEND_DOCUMENT) {
    throw badRequest(
      'idempotency_key was already used for a different command',
      'idempotency_key_mismatch',
    );
  }

  if (row.completed_at && row.income_document_id) {
    return { kind: 'replay', incomeDocumentId: String(row.income_document_id) };
  }

  throw conflict('Duplicate idempotency request in flight', 'idempotency_in_flight');
}

export async function completeIncomeIssueAndSendIdempotency(args: {
  leaseRowId: string;
  incomeDocumentId: string;
  sourceDraftId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('income_command_idempotency')
    .update({
      completed_at: new Date().toISOString(),
      income_document_id: args.incomeDocumentId,
      source_draft_id: args.sourceDraftId,
    })
    .eq('id', args.leaseRowId);
  if (error) throw error;
}

export async function abortIncomeIssueAndSendIdempotency(leaseRowId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('income_command_idempotency')
    .delete()
    .eq('id', leaseRowId);
  if (error) throw error;
}
