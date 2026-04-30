import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { addTimelineEvent, TIMELINE_SOURCE, TIMELINE_EVENTS } from './timeline.service.js';

function assertOrg(ctx: RequestContext, orgId: string): void {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
}
function assertPermission(ctx: RequestContext, permission: string): void {
  if (!ctx.membership?.permissions?.includes(permission)) throw forbidden('Insufficient permission');
}

export async function listNotes(ctx: RequestContext, orgId: string, clientId: string, options?: { includeSensitive?: boolean }) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:read');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const canViewSensitive = options?.includeSensitive && ctx.membership?.permissions?.includes('clients:view_sensitive');

  const { data } = await supabaseAdmin
    .from('client_notes')
    .select('id, author_user_id, note_text, visibility_scope, is_sensitive, created_at, updated_at')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  let list = (data ?? []) as { id: string; author_user_id: string; note_text: string; visibility_scope: string; is_sensitive: boolean; created_at: string; updated_at: string }[];
  if (!canViewSensitive) {
    list = list.map((n) => (n.is_sensitive ? { ...n, note_text: '[Sensitive]', is_sensitive: true } : n));
  }
  return list;
}

export async function addNote(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: { note_text: string; visibility_scope?: string; is_sensitive?: boolean }
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const noteText = String(body.note_text ?? '').trim();
  if (!noteText) throw badRequest('note_text is required');

  const visibilityScope = body.visibility_scope ?? 'organization';
  const isSensitive = body.is_sensitive ?? false;

  const { data: note, error } = await supabaseAdmin
    .from('client_notes')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      author_user_id: ctx.user.id,
      note_text: noteText,
      visibility_scope: visibilityScope,
      is_sensitive: isSensitive,
    })
    .select()
    .single();

  if (error) throw new Error('Failed to add note');

  await addTimelineEvent({
    organizationId: orgId,
    entityType: 'client',
    entityId: clientId,
    eventType: TIMELINE_EVENTS.NOTE_ADDED,
    sourceType: TIMELINE_SOURCE.MANUAL,
    actorUserId: ctx.user.id,
    visibilityScope,
    isSensitive,
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_note',
    entityId: note.id,
    action: AUDIT_ACTIONS.CLIENT_NOTE_ADDED,
    payload: { client_id: clientId, is_sensitive: isSensitive },
  });

  return note;
}

export async function viewSensitiveNote(ctx: RequestContext, orgId: string, clientId: string, noteId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:view_sensitive');

  const { data: note } = await supabaseAdmin
    .from('client_notes')
    .select('id, note_text, is_sensitive')
    .eq('id', noteId)
    .eq('client_id', clientId)
    .eq('organization_id', orgId)
    .single();
  if (!note || !note.is_sensitive) throw forbidden('Note not found or not sensitive');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_note',
    entityId: noteId,
    action: AUDIT_ACTIONS.CLIENT_SENSITIVE_NOTE_VIEWED,
    payload: { client_id: clientId },
  });

  return { note_text: note.note_text };
}

/**
 * Edit a client note. Rule: any user with clients:write can edit any note in the organization.
 * Object-level: client and note must belong to org; note must belong to client.
 */
export async function updateNote(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  noteId: string,
  body: { note_text: string; visibility_scope?: string; is_sensitive?: boolean }
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const { data: existing } = await supabaseAdmin
    .from('client_notes')
    .select('id, author_user_id, is_sensitive')
    .eq('id', noteId)
    .eq('client_id', clientId)
    .eq('organization_id', orgId)
    .single();
  if (!existing) throw forbidden('Note not found');

  const noteText = String(body.note_text ?? '').trim();
  if (!noteText) throw badRequest('note_text is required');

  const updates: Record<string, unknown> = {
    note_text: noteText,
    updated_at: new Date().toISOString(),
  };
  if (body.visibility_scope !== undefined) updates.visibility_scope = body.visibility_scope;
  if (body.is_sensitive !== undefined) updates.is_sensitive = body.is_sensitive;

  const { data: note, error } = await supabaseAdmin
    .from('client_notes')
    .update(updates)
    .eq('id', noteId)
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .select()
    .single();
  if (error) throw new Error('Failed to update note');

  await addTimelineEvent({
    organizationId: orgId,
    entityType: 'client',
    entityId: clientId,
    eventType: TIMELINE_EVENTS.NOTE_EDITED,
    sourceType: TIMELINE_SOURCE.MANUAL,
    actorUserId: ctx.user.id,
    payload: { note_id: noteId },
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_note',
    entityId: noteId,
    action: AUDIT_ACTIONS.CLIENT_NOTE_UPDATED,
    payload: { client_id: clientId, is_sensitive: (note as { is_sensitive: boolean }).is_sensitive },
  });

  return note;
}

/**
 * Delete a client note. Any user with clients:write can delete any note in the organization.
 * Object-level: client and note must belong to org; note must belong to client.
 */
export async function deleteNote(ctx: RequestContext, orgId: string, clientId: string, noteId: string): Promise<void> {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const { data: note } = await supabaseAdmin
    .from('client_notes')
    .select('id')
    .eq('id', noteId)
    .eq('client_id', clientId)
    .eq('organization_id', orgId)
    .single();
  if (!note) throw forbidden('Note not found');

  const { error } = await supabaseAdmin
    .from('client_notes')
    .delete()
    .eq('id', noteId)
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
  if (error) throw new Error('Failed to delete note');

  await addTimelineEvent({
    organizationId: orgId,
    entityType: 'client',
    entityId: clientId,
    eventType: TIMELINE_EVENTS.NOTE_DELETED,
    sourceType: TIMELINE_SOURCE.MANUAL,
    actorUserId: ctx.user.id,
    payload: { note_id: noteId },
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_note',
    entityId: noteId,
    action: AUDIT_ACTIONS.CLIENT_NOTE_DELETED,
    payload: { client_id: clientId },
  });
}
