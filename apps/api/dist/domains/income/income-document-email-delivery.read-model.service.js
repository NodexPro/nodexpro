/**
 * INV-1 P4 — delivery_attempts read projections for Income email history UI.
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { mapDeliveryAttemptRow } from '../delivery/delivery.pure.js';
const INCOME_SOURCE_MODULE = 'income';
const INCOME_SOURCE_ENTITY_TYPE = 'income_document';
const EMAIL_CHANNEL = 'email';
function mapRow(row) {
    return mapDeliveryAttemptRow(row);
}
export async function loadEmailAttemptCountsByDocumentIds(organizationId, documentIds) {
    const counts = new Map();
    if (documentIds.length === 0)
        return counts;
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
        const id = String(raw.source_entity_id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}
export async function listIncomeDocumentEmailAttempts(organizationId, incomeDocumentId, limit = 200) {
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
    return (data ?? []).map((row) => mapRow(row));
}
export async function listRepresentedClientEmailAttempts(organizationId, representedClientId, limit = 500) {
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
    return (data ?? []).map((row) => mapRow(row));
}
export async function loadIncomeDocumentsMetaByIds(organizationId, documentIds) {
    const meta = new Map();
    if (documentIds.length === 0)
        return meta;
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, document_number, document_type')
        .eq('organization_id', organizationId)
        .in('id', documentIds);
    throwIfSupabaseError(error, 'loadIncomeDocumentsMetaByIds');
    const labels = {
        quote: 'הצעת מחיר',
        deal_invoice: 'חשבון עסקה',
        tax_invoice: 'חשבונית מס',
        tax_invoice_receipt: 'חשבונית מס/קבלה',
        receipt: 'קבלה',
        credit_tax_invoice: 'זיכוי',
    };
    for (const raw of data ?? []) {
        const row = raw;
        meta.set(row.id, {
            document_number: row.document_number,
            document_type: row.document_type,
            document_type_label: labels[row.document_type] ?? row.document_type,
        });
    }
    return meta;
}
