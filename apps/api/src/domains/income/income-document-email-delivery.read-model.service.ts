/**
 * INV-1 P4 — delivery_attempts read projections for Income email history UI.
 */

import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { mapDeliveryAttemptRow } from '../delivery/delivery.pure.js';
import type { DeliveryAttemptRecord } from '../delivery/delivery.types.js';

const INCOME_SOURCE_MODULE = 'income';
const INCOME_SOURCE_ENTITY_TYPE = 'income_document';
const EMAIL_CHANNEL = 'email';

type DeliveryAttemptDbRow = Parameters<typeof mapDeliveryAttemptRow>[0];

function mapRow(row: DeliveryAttemptDbRow): DeliveryAttemptRecord {
  return mapDeliveryAttemptRow(row);
}

export async function loadEmailAttemptCountsByDocumentIds(
  organizationId: string,
  documentIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (documentIds.length === 0) return counts;

  const { data, error } = await supabaseAdmin
    .from('delivery_attempts')
    .select('source_entity_id')
    .eq('organization_id', organizationId)
    .eq('source_module', INCOME_SOURCE_MODULE)
    .eq('source_entity_type', INCOME_SOURCE_ENTITY_TYPE)
    .eq('channel', EMAIL_CHANNEL)
    .in('source_entity_id', documentIds);
  throwIfSupabaseError(error, 'loadEmailAttemptCountsByDocumentIds');

  for (const raw of data ?? []) {
    const id = String((raw as { source_entity_id: string }).source_entity_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function listIncomeDocumentEmailAttempts(
  organizationId: string,
  incomeDocumentId: string,
  limit = 200,
): Promise<DeliveryAttemptRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('delivery_attempts')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('source_module', INCOME_SOURCE_MODULE)
    .eq('source_entity_type', INCOME_SOURCE_ENTITY_TYPE)
    .eq('source_entity_id', incomeDocumentId)
    .eq('channel', EMAIL_CHANNEL)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  throwIfSupabaseError(error, 'listIncomeDocumentEmailAttempts');
  return (data ?? []).map((row) => mapRow(row as DeliveryAttemptDbRow));
}

export async function listRepresentedClientEmailAttempts(
  organizationId: string,
  representedClientId: string,
  limit = 500,
): Promise<DeliveryAttemptRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('delivery_attempts')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('represented_client_id', representedClientId)
    .eq('source_module', INCOME_SOURCE_MODULE)
    .eq('source_entity_type', INCOME_SOURCE_ENTITY_TYPE)
    .eq('channel', EMAIL_CHANNEL)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  throwIfSupabaseError(error, 'listRepresentedClientEmailAttempts');
  return (data ?? []).map((row) => mapRow(row as DeliveryAttemptDbRow));
}

export async function loadIncomeDocumentsMetaByIds(
  organizationId: string,
  documentIds: string[],
): Promise<
  Map<
    string,
    {
      document_number: string;
      document_type: string;
      document_type_label: string;
    }
  >
> {
  const meta = new Map<
    string,
    { document_number: string; document_type: string; document_type_label: string }
  >();
  if (documentIds.length === 0) return meta;

  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id, document_number, document_type')
    .eq('organization_id', organizationId)
    .in('id', documentIds);
  throwIfSupabaseError(error, 'loadIncomeDocumentsMetaByIds');

  const labels: Record<string, string> = {
    quote: 'הצעת מחיר',
    deal_invoice: 'חשבון עסקה',
    tax_invoice: 'חשבונית מס',
    tax_invoice_receipt: 'חשבונית מס/קבלה',
    receipt: 'קבלה',
    credit_tax_invoice: 'זיכוי',
  };

  for (const raw of data ?? []) {
    const row = raw as { id: string; document_number: string; document_type: string };
    meta.set(row.id, {
      document_number: row.document_number,
      document_type: row.document_type,
      document_type_label: labels[row.document_type] ?? row.document_type,
    });
  }
  return meta;
}
