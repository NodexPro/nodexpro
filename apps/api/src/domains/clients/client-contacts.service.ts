import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { addTimelineEvent, TIMELINE_SOURCE, TIMELINE_EVENTS } from './timeline.service.js';
import { buildClientSearchText, refreshClientSearchIndexWithContacts } from './search-index.service.js';

function assertOrg(ctx: RequestContext, orgId: string): void {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
}
function assertPermission(ctx: RequestContext, permission: string): void {
  if (!ctx.membership?.permissions?.includes(permission)) throw forbidden('Insufficient permission');
}

export async function listContacts(ctx: RequestContext, orgId: string, clientId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:read');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const { data } = await supabaseAdmin
    .from('client_contacts')
    .select('*')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('is_primary', { ascending: false })
    .order('full_name');
  return data ?? [];
}

export async function addContact(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: { full_name: string; email?: string | null; phone?: string | null; title?: string | null; is_primary?: boolean }
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: client } = await supabaseAdmin.from('clients').select('id, display_name, legal_name, tax_id, external_code, email, phone').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const fullName = String(body.full_name ?? '').trim();
  if (!fullName) throw badRequest('full_name is required');

  const { data: contact, error } = await supabaseAdmin
    .from('client_contacts')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      full_name: fullName,
      email: body.email?.trim() ?? null,
      phone: body.phone?.trim() ?? null,
      title: body.title?.trim() ?? null,
      is_primary: body.is_primary ?? false,
      status: 'active',
      created_by: ctx.user.id,
    })
    .select()
    .single();

  if (error) throw new Error('Failed to add contact');

  const contacts = await listContacts(ctx, orgId, clientId);
  const contactTexts = (contacts as { full_name: string; email: string | null; phone: string | null }[]).map(
    (c) => [c.full_name, c.email, c.phone].filter(Boolean).join(' ')
  );
  await refreshClientSearchIndexWithContacts(orgId, clientId, buildClientSearchText(client), contactTexts);

  await addTimelineEvent({
    organizationId: orgId,
    entityType: 'client',
    entityId: clientId,
    eventType: TIMELINE_EVENTS.CONTACT_ADDED,
    sourceType: TIMELINE_SOURCE.SYSTEM,
    actorUserId: ctx.user.id,
    payload: { contact_id: contact.id, full_name: contact.full_name },
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_contact',
    entityId: contact.id,
    action: AUDIT_ACTIONS.CLIENT_CONTACT_ADDED,
    payload: { client_id: clientId },
  });

  return contact;
}

export async function updateContact(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  contactId: string,
  body: Partial<{ full_name: string; email: string | null; phone: string | null; title: string | null; is_primary: boolean; status: string }>
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: client } = await supabaseAdmin.from('clients').select('id, display_name, legal_name, tax_id, external_code, email, phone').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.full_name !== undefined) updatePayload.full_name = body.full_name.trim();
  if (body.email !== undefined) updatePayload.email = body.email?.trim() ?? null;
  if (body.phone !== undefined) updatePayload.phone = body.phone?.trim() ?? null;
  if (body.title !== undefined) updatePayload.title = body.title?.trim() ?? null;
  if (body.is_primary !== undefined) updatePayload.is_primary = body.is_primary;
  if (body.status !== undefined) updatePayload.status = body.status;

  const { data: contact, error } = await supabaseAdmin
    .from('client_contacts')
    .update(updatePayload)
    .eq('id', contactId)
    .eq('client_id', clientId)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (error || !contact) throw forbidden('Contact not found');

  const contacts = await listContacts(ctx, orgId, clientId);
  const contactTexts = (contacts as { full_name: string; email: string | null; phone: string | null }[]).map(
    (c) => [c.full_name, c.email, c.phone].filter(Boolean).join(' ')
  );
  await refreshClientSearchIndexWithContacts(orgId, clientId, buildClientSearchText(client), contactTexts);

  await addTimelineEvent({
    organizationId: orgId,
    entityType: 'client',
    entityId: clientId,
    eventType: TIMELINE_EVENTS.CONTACT_UPDATED,
    sourceType: TIMELINE_SOURCE.SYSTEM,
    actorUserId: ctx.user.id,
    payload: { contact_id: contactId },
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_contact',
    entityId: contactId,
    action: AUDIT_ACTIONS.CLIENT_CONTACT_UPDATED,
    payload: { client_id: clientId },
  });

  return contact;
}

export async function deleteContact(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  contactId: string
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: existing } = await supabaseAdmin
    .from('client_contacts')
    .select('id')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .eq('organization_id', orgId)
    .single();
  if (!existing) throw forbidden('Contact not found');

  const { error } = await supabaseAdmin
    .from('client_contacts')
    .delete()
    .eq('id', contactId)
    .eq('client_id', clientId)
    .eq('organization_id', orgId);
  if (error) throw new Error('Failed to delete contact');

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, legal_name, tax_id, external_code, email, phone')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .single();
  if (!client) throw forbidden('Client not found');

  const contacts = await listContacts(ctx, orgId, clientId);
  const contactTexts = (contacts as { full_name: string; email: string | null; phone: string | null }[]).map(
    (c) => [c.full_name, c.email, c.phone].filter(Boolean).join(' ')
  );
  await refreshClientSearchIndexWithContacts(orgId, clientId, buildClientSearchText(client), contactTexts);

  await addTimelineEvent({
    organizationId: orgId,
    entityType: 'client',
    entityId: clientId,
    eventType: TIMELINE_EVENTS.CONTACT_REMOVED,
    sourceType: TIMELINE_SOURCE.SYSTEM,
    actorUserId: ctx.user.id,
    payload: { contact_id: contactId },
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_contact',
    entityId: contactId,
    action: AUDIT_ACTIONS.CLIENT_CONTACT_REMOVED,
    payload: { client_id: clientId },
  });
}

export async function setPrimaryContact(ctx: RequestContext, orgId: string, clientId: string, contactId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  await supabaseAdmin.from('client_contacts').update({ is_primary: false, updated_at: new Date().toISOString() }).eq('client_id', clientId).eq('organization_id', orgId);
  const { data: contact } = await supabaseAdmin
    .from('client_contacts')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('client_id', clientId)
    .eq('organization_id', orgId)
    .select()
    .single();
  if (!contact) throw forbidden('Contact not found');
  return contact;
}
