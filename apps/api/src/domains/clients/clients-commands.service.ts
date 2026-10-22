/**
 * Core client card commands. Each write uses the existing validated service,
 * then returns the authorized Client Card aggregate.
 */
import type { RequestContext } from '../../shared/context.js';
import { badRequest } from '../../shared/errors.js';
import * as clientsService from './clients.service.js';
import * as contactsService from './client-contacts.service.js';
import * as notesService from './client-notes.service.js';
import { getClientCardData, type ClientCardData } from './client-card.service.js';

export type UpdateClientCommandBody = Partial<{
  tax_id: string;
  client_type: string;
  display_name: string;
  legal_name: string | null;
  external_code: string | null;
  country_code: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  street: string | null;
  postal_code: string | null;
  status: string;
  lifecycle_state: string;
  owner_user_id: string | null;
}>;

export type ContactCommandBody = {
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  is_primary?: boolean;
};

function pickUpdateClientBody(body: Record<string, unknown>): UpdateClientCommandBody {
  const out: UpdateClientCommandBody = {};
  const keys: Array<keyof UpdateClientCommandBody> = [
    'tax_id',
    'client_type',
    'display_name',
    'legal_name',
    'external_code',
    'country_code',
    'email',
    'phone',
    'website',
    'city',
    'street',
    'postal_code',
    'status',
    'lifecycle_state',
    'owner_user_id',
  ];
  for (const key of keys) {
    if (body[key] !== undefined) (out as Record<string, unknown>)[key] = body[key];
  }
  return out;
}

function pickContactBody(body: Record<string, unknown>): ContactCommandBody {
  const out: ContactCommandBody = {};
  if (typeof body.full_name === 'string') out.full_name = body.full_name;
  if (body.email !== undefined) out.email = body.email === null ? null : String(body.email);
  if (body.phone !== undefined) out.phone = body.phone === null ? null : String(body.phone);
  if (body.title !== undefined) out.title = body.title === null ? null : String(body.title);
  if (typeof body.is_primary === 'boolean') out.is_primary = body.is_primary;
  return out;
}

async function refreshedCard(ctx: RequestContext, orgId: string, clientId: string): Promise<ClientCardData> {
  return getClientCardData(ctx, orgId, clientId);
}

export async function executeUpdateClientCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: Record<string, unknown>,
): Promise<ClientCardData> {
  await clientsService.updateClient(ctx, orgId, clientId, pickUpdateClientBody(body));
  return refreshedCard(ctx, orgId, clientId);
}

export async function executeAddContactCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: Record<string, unknown>,
): Promise<ClientCardData> {
  const contact = pickContactBody(body);
  if (!contact.full_name?.trim()) throw badRequest('full_name is required');
  await contactsService.addContact(ctx, orgId, clientId, {
    full_name: contact.full_name,
    email: contact.email,
    phone: contact.phone,
    title: contact.title,
    is_primary: contact.is_primary,
  });
  return refreshedCard(ctx, orgId, clientId);
}

export async function executeUpdateContactCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  contactId: string,
  body: Record<string, unknown>,
): Promise<ClientCardData> {
  await contactsService.updateContact(ctx, orgId, clientId, contactId, pickContactBody(body));
  return refreshedCard(ctx, orgId, clientId);
}

export async function executeDeleteContactCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  contactId: string,
): Promise<ClientCardData> {
  await contactsService.deleteContact(ctx, orgId, clientId, contactId);
  return refreshedCard(ctx, orgId, clientId);
}

export async function executeAddNoteCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: Record<string, unknown>,
): Promise<ClientCardData> {
  const noteText = typeof body.note_text === 'string' ? body.note_text : '';
  if (!noteText.trim()) throw badRequest('note_text is required');
  await notesService.addNote(ctx, orgId, clientId, {
    note_text: noteText,
    visibility_scope: typeof body.visibility_scope === 'string' ? body.visibility_scope : undefined,
    is_sensitive: typeof body.is_sensitive === 'boolean' ? body.is_sensitive : undefined,
  });
  return refreshedCard(ctx, orgId, clientId);
}

export async function executeUpdateNoteCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  noteId: string,
  body: Record<string, unknown>,
): Promise<ClientCardData> {
  const noteText = typeof body.note_text === 'string' ? body.note_text : '';
  if (!noteText.trim()) throw badRequest('note_text is required');
  await notesService.updateNote(ctx, orgId, clientId, noteId, {
    note_text: noteText,
    visibility_scope: typeof body.visibility_scope === 'string' ? body.visibility_scope : undefined,
    is_sensitive: typeof body.is_sensitive === 'boolean' ? body.is_sensitive : undefined,
  });
  return refreshedCard(ctx, orgId, clientId);
}

export async function executeDeleteNoteCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  noteId: string,
): Promise<ClientCardData> {
  await notesService.deleteNote(ctx, orgId, clientId, noteId);
  return refreshedCard(ctx, orgId, clientId);
}
