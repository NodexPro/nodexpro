import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';

const DOCUMENT_TYPES = ['invoice', 'receipt', 'contract', 'statement', 'payroll_document', 'tax_document', 'other'] as const;
const LIFECYCLE_STATES = ['uploaded', 'pending_classification', 'classified', 'linked', 'reviewed', 'approved', 'rejected', 'archived', 'superseded'] as const;
const SENSITIVITY_LEVELS = ['normal', 'internal', 'sensitive', 'restricted'] as const;

function assertOrg(ctx: RequestContext, orgId: string): void {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
}
function assertPermission(ctx: RequestContext, permission: string): void {
  if (!ctx.membership?.permissions?.includes(permission)) throw forbidden('Insufficient permission');
}
function assertSensitive(ctx: RequestContext): void {
  if (!ctx.membership?.permissions?.includes('documents:view_sensitive')) throw forbidden('Cannot view sensitive documents');
}

export interface DocumentRow {
  id: string;
  organization_id: string;
  document_code: string | null;
  title: string | null;
  primary_client_id: string | null;
  document_type_code: string;
  lifecycle_state: string;
  status: string;
  sensitivity_level: string;
  source_type: string;
  source_reference: string | null;
  current_version_id: string | null;
  issue_date: string | null;
  document_date: string | null;
  amount_total: number | null;
  currency: string | null;
  external_reference: string | null;
  is_archived: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function listDocuments(
  ctx: RequestContext,
  orgId: string,
  opts: { includeArchived?: boolean; documentType?: string; primaryClientId?: string; linkedToClientId?: string } = {}
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'documents:read');

  let documentIds: string[] | null = null;
  if (opts.linkedToClientId) {
    const [linkRes, primaryRes] = await Promise.all([
      supabaseAdmin.from('document_links').select('document_id').eq('organization_id', orgId).eq('target_entity_type', 'client').eq('target_entity_id', opts.linkedToClientId),
      supabaseAdmin.from('documents').select('id').eq('organization_id', orgId).eq('primary_client_id', opts.linkedToClientId),
    ]);
    const linkIds = (linkRes.data ?? []).map((r) => (r as { document_id: string }).document_id);
    const primaryIds = (primaryRes.data ?? []).map((r) => (r as { id: string }).id);
    documentIds = [...new Set([...linkIds, ...primaryIds])];
    if (documentIds.length === 0) return [];
  }

  let q = supabaseAdmin
    .from('documents')
    .select('id, document_code, title, primary_client_id, document_type_code, lifecycle_state, status, sensitivity_level, current_version_id, issue_date, document_date, amount_total, currency, external_reference, is_archived, created_by, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (!opts.includeArchived) q = q.eq('is_archived', false);
  if (opts.documentType) q = q.eq('document_type_code', opts.documentType);
  if (opts.primaryClientId && !opts.linkedToClientId) q = q.eq('primary_client_id', opts.primaryClientId);
  if (documentIds !== null) q = q.in('id', documentIds);

  const { data } = await q;
  const rows = (data ?? []) as DocumentRow[];
  const canViewSensitive = ctx.membership?.permissions?.includes('documents:view_sensitive');
  return rows.map((r) => {
    const out = { ...r };
    if (!canViewSensitive && ['sensitive', 'restricted'].includes(r.sensitivity_level)) {
      (out as Record<string, unknown>).sensitivity_level = 'restricted';
    }
    return out;
  });
}

export async function getDocumentById(ctx: RequestContext, orgId: string, documentId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'documents:read');

  const { data: doc } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('organization_id', orgId)
    .single();
  if (!doc) throw forbidden('Document not found');

  const canViewSensitive = ctx.membership?.permissions?.includes('documents:view_sensitive');
  if (!canViewSensitive && ['sensitive', 'restricted'].includes(doc.sensitivity_level)) {
    assertSensitive(ctx);
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'document',
    entityId: documentId,
    action: doc.sensitivity_level === 'sensitive' || doc.sensitivity_level === 'restricted' ? AUDIT_ACTIONS.DOCUMENT_SENSITIVE_VIEWED : AUDIT_ACTIONS.DOCUMENT_VIEWED,
    payload: {},
  });

  return doc;
}

export async function updateDocument(
  ctx: RequestContext,
  orgId: string,
  documentId: string,
  body: Partial<{
    title: string;
    document_type_code: string;
    lifecycle_state: string;
    status: string;
    primary_client_id: string | null;
    issue_date: string | null;
    document_date: string | null;
    amount_total: number | null;
    currency: string | null;
    external_reference: string | null;
  }>
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'documents:write');

  const { data: existing } = await supabaseAdmin.from('documents').select('id, status, lifecycle_state').eq('id', documentId).eq('organization_id', orgId).single();
  if (!existing) throw forbidden('Document not found');

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.document_type_code !== undefined) {
    if (!DOCUMENT_TYPES.includes(body.document_type_code as (typeof DOCUMENT_TYPES)[number])) throw badRequest('Invalid document_type_code');
    updates.document_type_code = body.document_type_code;
  }
  if (body.lifecycle_state !== undefined) {
    if (!LIFECYCLE_STATES.includes(body.lifecycle_state as (typeof LIFECYCLE_STATES)[number])) throw badRequest('Invalid lifecycle_state');
    updates.lifecycle_state = body.lifecycle_state;
  }
  if (body.status !== undefined) updates.status = body.status;
  if (body.primary_client_id !== undefined) updates.primary_client_id = body.primary_client_id;
  if (body.issue_date !== undefined) updates.issue_date = body.issue_date;
  if (body.document_date !== undefined) updates.document_date = body.document_date;
  if (body.amount_total !== undefined) updates.amount_total = body.amount_total;
  if (body.currency !== undefined) updates.currency = body.currency;
  if (body.external_reference !== undefined) updates.external_reference = body.external_reference;

  const { data: updated } = await supabaseAdmin.from('documents').update(updates).eq('id', documentId).eq('organization_id', orgId).select().single();
  if (!updated) throw new Error('Failed to update document');

  if (body.status !== undefined && body.status !== existing.status) {
    await supabaseAdmin.from('document_status_history').insert({
      organization_id: orgId,
      document_id: documentId,
      from_status: existing.status,
      to_status: body.status,
      changed_by: ctx.user.id,
      source_type: 'manual',
    });
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'document',
    entityId: documentId,
    action: AUDIT_ACTIONS.DOCUMENT_UPDATED,
    payload: { fields: Object.keys(updates) },
  });

  return updated;
}

export async function getDocumentActivity(ctx: RequestContext, orgId: string, documentId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'documents:read');

  const { data: doc } = await supabaseAdmin.from('documents').select('id').eq('id', documentId).eq('organization_id', orgId).single();
  if (!doc) throw forbidden('Document not found');

  const { data } = await supabaseAdmin
    .from('document_activity_timeline')
    .select('id, event_type, source_module, actor_user_id, is_sensitive, payload_json, created_at')
    .eq('document_id', documentId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function archiveDocument(ctx: RequestContext, orgId: string, documentId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'documents:archive');

  const { data: doc } = await supabaseAdmin.from('documents').select('id').eq('id', documentId).eq('organization_id', orgId).single();
  if (!doc) throw forbidden('Document not found');

  const { data: updated } = await supabaseAdmin
    .from('documents')
    .update({ is_archived: true, lifecycle_state: 'archived', status: 'inactive' })
    .eq('id', documentId)
    .eq('organization_id', orgId)
    .select()
    .single();
  if (!updated) throw new Error('Failed to archive document');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'document',
    entityId: documentId,
    action: AUDIT_ACTIONS.DOCUMENT_ARCHIVED,
    payload: {},
  });

  return updated;
}
