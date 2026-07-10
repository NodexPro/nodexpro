/**
 * Work Engine — failed operational items (org-scoped read only).
 */

import { supabaseAdmin } from '../../db/client.js';
import {
  buildAccountingPostingFailedRow,
  buildDeliveryFailedRow,
  buildFailedOperationsSummary,
  buildIncomePdfFailedRow,
  buildRetainerGenerationFailedRow,
  buildWorkEventFailedRow,
  FAILED_OPERATIONS_NOT_INCLUDED_NOTES,
  resolveClientLabel,
  type FailedOperationRow,
} from './work-engine-failed-operations.pure.js';

const ROWS_PER_SOURCE = 100;

async function loadClientNameMap(orgId: string, clientIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(clientIds.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name')
    .eq('organization_id', orgId)
    .in('id', unique);
  if (error) throw error;
  for (const raw of data ?? []) {
    const row = raw as { id: string; display_name: string | null };
    map.set(row.id, row.display_name?.trim() || row.id);
  }
  return map;
}

async function countDeliveryFailures(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('delivery_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('result', 'failed');
  if (error) throw error;
  return count ?? 0;
}

async function countIncomePdfFailures(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('income_documents')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('pdf_render_status', 'failed');
  if (error) throw error;
  return count ?? 0;
}

async function countWorkEventIntakeFailures(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('work_events')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('processing_status', 'failed');
  if (error) throw error;
  return count ?? 0;
}

async function countRetainerGenerationFailures(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'failed');
  if (error) throw error;
  return count ?? 0;
}

async function countAccountingPostingFailures(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('income_documents')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('accounting_posting_status', 'failed');
  if (error) throw error;
  return count ?? 0;
}

async function loadDeliveryFailureRows(orgId: string): Promise<FailedOperationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('delivery_attempts')
    .select(
      'id, represented_client_id, source_module, source_entity_type, source_entity_id, channel, failure_reason, updated_at, created_at',
    )
    .eq('organization_id', orgId)
    .eq('result', 'failed')
    .order('updated_at', { ascending: false })
    .limit(ROWS_PER_SOURCE);
  if (error) throw error;
  const clientIds = (data ?? []).map((r) => String((r as { represented_client_id: string }).represented_client_id));
  const clientNameById = await loadClientNameMap(orgId, clientIds);
  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      represented_client_id: string;
      source_module: string;
      source_entity_type: string;
      source_entity_id: string;
      channel: string;
      failure_reason: string | null;
      updated_at: string;
      created_at: string;
    };
    return buildDeliveryFailedRow({
      id: row.id,
      client_id: row.represented_client_id,
      client_label: resolveClientLabel(row.represented_client_id, clientNameById),
      source_module: row.source_module,
      channel: row.channel,
      failure_reason: row.failure_reason,
      source_entity_type: row.source_entity_type,
      source_entity_id: row.source_entity_id,
      occurred_at: row.updated_at || row.created_at,
    });
  });
}

async function loadIncomePdfFailureRows(orgId: string): Promise<FailedOperationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id, represented_client_id, document_type, document_number, updated_at, created_at')
    .eq('organization_id', orgId)
    .eq('pdf_render_status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(ROWS_PER_SOURCE);
  if (error) throw error;
  const clientIds = (data ?? []).map((r) => {
    const id = (r as { represented_client_id: string | null }).represented_client_id;
    return id ? String(id) : '';
  });
  const clientNameById = await loadClientNameMap(orgId, clientIds);
  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      represented_client_id: string | null;
      document_type: string;
      document_number: string | null;
      updated_at: string;
      created_at: string;
    };
    return buildIncomePdfFailedRow({
      id: row.id,
      client_id: row.represented_client_id,
      client_label: resolveClientLabel(row.represented_client_id, clientNameById),
      document_type: row.document_type,
      document_number: row.document_number,
      occurred_at: row.updated_at || row.created_at,
    });
  });
}

async function loadWorkEventFailureRows(orgId: string): Promise<FailedOperationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('work_events')
    .select('id, client_id, source_module, event_type, received_at, processing_error')
    .eq('org_id', orgId)
    .eq('processing_status', 'failed')
    .order('received_at', { ascending: false })
    .limit(ROWS_PER_SOURCE);
  if (error) throw error;
  const clientIds = (data ?? []).map((r) => {
    const id = (r as { client_id: string | null }).client_id;
    return id ? String(id) : '';
  });
  const clientNameById = await loadClientNameMap(orgId, clientIds);
  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      client_id: string | null;
      source_module: string;
      event_type: string;
      received_at: string;
      processing_error: string | null;
    };
    return buildWorkEventFailedRow({
      id: row.id,
      client_id: row.client_id,
      client_label: resolveClientLabel(row.client_id, clientNameById),
      source_module: row.source_module,
      event_type: row.event_type,
      processing_error: row.processing_error,
      occurred_at: row.received_at,
    });
  });
}

async function loadRetainerGenerationFailureRows(orgId: string): Promise<FailedOperationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select(
      'id, cycle_number, failure_reason, updated_at, created_at, income_recurring_document_profiles!inner(represented_client_id)',
    )
    .eq('organization_id', orgId)
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(ROWS_PER_SOURCE);
  if (error) throw error;
  const clientIds: string[] = [];
  for (const raw of data ?? []) {
    const profile = (raw as {
      income_recurring_document_profiles:
        | { represented_client_id: string }
        | { represented_client_id: string }[]
        | null;
    }).income_recurring_document_profiles;
    const p = Array.isArray(profile) ? profile[0] : profile;
    if (p?.represented_client_id) clientIds.push(String(p.represented_client_id));
  }
  const clientNameById = await loadClientNameMap(orgId, clientIds);
  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      cycle_number: number;
      failure_reason: string | null;
      updated_at: string;
      created_at: string;
      income_recurring_document_profiles:
        | { represented_client_id: string }
        | { represented_client_id: string }[]
        | null;
    };
    const profile = Array.isArray(row.income_recurring_document_profiles)
      ? row.income_recurring_document_profiles[0]
      : row.income_recurring_document_profiles;
    const clientId = profile?.represented_client_id ?? null;
    return buildRetainerGenerationFailedRow({
      id: row.id,
      client_id: clientId,
      client_label: resolveClientLabel(clientId, clientNameById),
      cycle_number: row.cycle_number,
      failure_reason: row.failure_reason,
      occurred_at: row.updated_at || row.created_at,
    });
  });
}

async function loadAccountingPostingFailureRows(orgId: string): Promise<FailedOperationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id, represented_client_id, document_type, document_number, updated_at, created_at')
    .eq('organization_id', orgId)
    .eq('accounting_posting_status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(ROWS_PER_SOURCE);
  if (error) throw error;
  const clientIds = (data ?? []).map((r) => {
    const id = (r as { represented_client_id: string | null }).represented_client_id;
    return id ? String(id) : '';
  });
  const clientNameById = await loadClientNameMap(orgId, clientIds);
  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      represented_client_id: string | null;
      document_type: string;
      document_number: string | null;
      updated_at: string;
      created_at: string;
    };
    return buildAccountingPostingFailedRow({
      id: row.id,
      client_id: row.represented_client_id,
      client_label: resolveClientLabel(row.represented_client_id, clientNameById),
      document_type: row.document_type,
      document_number: row.document_number,
      occurred_at: row.updated_at || row.created_at,
    });
  });
}

export async function loadFailedOperationsSummary(orgId: string) {
  const [
    deliveryFailedCount,
    incomePdfFailedCount,
    workEventFailedCount,
    retainerFailedCount,
    accountingPostingFailedCount,
    deliveryRows,
    incomePdfRows,
    workEventRows,
    retainerRows,
    accountingPostingRows,
  ] = await Promise.all([
    countDeliveryFailures(orgId),
    countIncomePdfFailures(orgId),
    countWorkEventIntakeFailures(orgId),
    countRetainerGenerationFailures(orgId),
    countAccountingPostingFailures(orgId),
    loadDeliveryFailureRows(orgId),
    loadIncomePdfFailureRows(orgId),
    loadWorkEventFailureRows(orgId),
    loadRetainerGenerationFailureRows(orgId),
    loadAccountingPostingFailureRows(orgId),
  ]);

  return buildFailedOperationsSummary({
    deliveryFailedCount,
    incomePdfFailedCount,
    workEventFailedCount,
    retainerFailedCount,
    accountingPostingFailedCount,
    rows: [
      ...deliveryRows,
      ...incomePdfRows,
      ...workEventRows,
      ...retainerRows,
      ...accountingPostingRows,
    ],
    notes: [...FAILED_OPERATIONS_NOT_INCLUDED_NOTES],
  });
}
