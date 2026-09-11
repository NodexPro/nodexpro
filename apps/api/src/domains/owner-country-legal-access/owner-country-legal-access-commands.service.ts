import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { assertCountryExists } from '../country-pack/country.service.js';
import { buildOwnerLegalControlPanelAggregate } from '../country-pack/country-pack-read-models.service.js';
import { auditPayloadHasSecret, normalizeGrantedCapabilities, normalizeOwnerLegalEmail } from './owner-country-legal-access.pure.js';
import { requestedCountriesFromPayload } from './owner-country-legal-access-country-resolve.service.js';
import { loadOwnerLegalAssignments, type OwnerLegalAssignmentRow } from './owner-country-legal-access.service.js';
import { loadOwnerLegalActor } from './owner-country-legal-access.service.js';
import {
  isOwnerCountryLegalAccessCommand,
  type OwnerCountryLegalAccessCommandName,
} from './owner-country-legal-access.types.js';

export { isOwnerCountryLegalAccessCommand };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AccessCommandResponse = {
  ok: true;
  command: OwnerCountryLegalAccessCommandName;
  refreshed: {
    aggregate_key: 'owner_legal_control_panel_aggregate';
    aggregate: Record<string, unknown>;
  };
};

function asUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw badRequest(`${field} must be a UUID`);
  }
  return value.trim();
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be a string');
  const note = value.trim();
  return note.length ? note.slice(0, 2000) : null;
}

async function findUserIdByNormalizedEmail(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('users').select('id, email').ilike('email', email);
  if (error) throw error;
  const matches = (data ?? []).filter((row) => normalizeOwnerLegalEmail(row.email) === email);
  return matches.length === 1 ? String(matches[0].id) : null;
}

async function auditAccess(
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (auditPayloadHasSecret(payload)) {
    throw badRequest('Audit payload must not contain secrets');
  }
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType,
    entityId,
    action,
    payload,
  });
}

async function refreshed(ctx: RequestContext): Promise<AccessCommandResponse['refreshed']> {
  const actor = await loadOwnerLegalActor(ctx);
  if (!actor) {
    const { buildPendingRequesterPanel } = await import('./owner-country-legal-access-read-models.service.js');
    return {
      aggregate_key: 'owner_legal_control_panel_aggregate',
      aggregate: await buildPendingRequesterPanel(ctx),
    };
  }
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    aggregate: await buildOwnerLegalControlPanelAggregate(ctx),
  };
}

async function insertAssignment(
  ctx: RequestContext,
  params: {
    email: string;
    userId: string | null;
    countryCode: string;
    capabilities: string[];
    existing?: OwnerLegalAssignmentRow | null;
  },
): Promise<OwnerLegalAssignmentRow> {
  await assertCountryExists(params.countryCode);
  const live = params.existing
    ? params.existing
    : (await loadOwnerLegalAssignments({ email: params.email })).find(
        (row) => row.country_code === params.countryCode && (row.status === 'active' || row.status === 'suspended'),
      );
  if (live?.status === 'active') {
    throw conflict('An active country assignment already exists for this email');
  }
  const previousCapabilities = live?.capabilities ?? [];
  if (live?.status === 'suspended') {
    const { data, error } = await supabaseAdmin
      .from('owner_country_legal_assignments')
      .update({
        user_id: params.userId ?? live.user_id,
        capabilities: params.capabilities,
        status: 'active',
        granted_by_user_id: ctx.user.id,
        granted_at: new Date().toISOString(),
        suspended_at: null,
        suspended_by_user_id: null,
      })
      .eq('id', live.id)
      .select(
        'id, email_normalized, user_id, country_code, capabilities, status, granted_by_user_id, granted_at, suspended_at, suspended_by_user_id, revoked_at, revoked_by_user_id, updated_at',
      )
      .single();
    if (error) throw error;
    await writeCapabilityAudits(ctx, data as OwnerLegalAssignmentRow, previousCapabilities, true);
    return data as OwnerLegalAssignmentRow;
  }

  const { data, error } = await supabaseAdmin
    .from('owner_country_legal_assignments')
    .insert({
      email_normalized: params.email,
      user_id: params.userId,
      country_code: params.countryCode,
      capabilities: params.capabilities,
      status: 'active',
      granted_by_user_id: ctx.user.id,
    })
    .select(
      'id, email_normalized, user_id, country_code, capabilities, status, granted_by_user_id, granted_at, suspended_at, suspended_by_user_id, revoked_at, revoked_by_user_id, updated_at',
    )
    .single();
  if (error) throw error;
  const row = data as OwnerLegalAssignmentRow;
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ASSIGNMENT_CREATED, 'owner_country_legal_assignment', row.id, {
    target_email: params.email,
    target_user_id: params.userId,
    country_code: params.countryCode,
    capabilities: params.capabilities,
    action: 'assignment_created',
  });
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_COUNTRY_ADDED, 'owner_country_legal_assignment', row.id, {
    target_email: params.email,
    target_user_id: params.userId,
    country_code: params.countryCode,
    capabilities: params.capabilities,
    action: 'country_added',
  });
  await writeCapabilityAudits(ctx, row, [], true);
  return row;
}

async function writeCapabilityAudits(
  ctx: RequestContext,
  row: OwnerLegalAssignmentRow,
  previous: string[],
  includeActivateEvents: boolean,
): Promise<void> {
  const prev = new Set(previous);
  const next = new Set(row.capabilities);
  if (JSON.stringify([...prev].sort()) !== JSON.stringify([...next].sort())) {
    await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_CAPABILITY_CHANGED, 'owner_country_legal_assignment', row.id, {
      target_email: row.email_normalized,
      target_user_id: row.user_id,
      country_code: row.country_code,
      previous_capabilities: previous,
      capabilities: row.capabilities,
      action: 'capability_changed',
    });
  }
  if (!includeActivateEvents) return;
  const hadActivate = prev.has('legal_knowledge.activate');
  const hasActivate = next.has('legal_knowledge.activate');
  if (!hadActivate && hasActivate) {
    await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ACTIVATE_GRANTED, 'owner_country_legal_assignment', row.id, {
      target_email: row.email_normalized,
      target_user_id: row.user_id,
      country_code: row.country_code,
      capabilities: row.capabilities,
      action: 'activate_granted',
    });
  }
  if (hadActivate && !hasActivate) {
    await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ACTIVATE_REMOVED, 'owner_country_legal_assignment', row.id, {
      target_email: row.email_normalized,
      target_user_id: row.user_id,
      country_code: row.country_code,
      capabilities: row.capabilities,
      action: 'activate_removed',
    });
  }
}

async function handleRequest(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  const email = normalizeOwnerLegalEmail(ctx.user.email);
  if (!email) throw badRequest('Authenticated email is required');
  const countries = requestedCountriesFromPayload(payload);
  if (!countries.length) throw badRequest('requested_country_codes is required');
  for (const country of countries) await assertCountryExists(country);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .select('id, status')
    .eq('email_normalized', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw conflict('A pending country legal access request already exists for this email');

  const { data, error } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .insert({
      email_normalized: email,
      requested_user_id: ctx.user.id,
      requested_country_codes: countries,
      note: optionalNote(payload.note ?? payload.reason),
      status: 'pending',
      source: 'self_request',
    })
    .select('id')
    .single();
  if (error) {
    if (String(error.code) === '23505') throw conflict('A pending country legal access request already exists for this email');
    throw error;
  }
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ACCESS_REQUEST_CREATED, 'owner_country_legal_access_request', data.id, {
    target_email: email,
    target_user_id: ctx.user.id,
    country_codes: countries,
    capabilities: [],
    action: 'request_created',
  });
  return { ok: true, command: 'request_country_legal_access', refreshed: await refreshed(ctx) };
}

async function handleInvite(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  assertPlatformOwner(ctx);
  const email = normalizeOwnerLegalEmail(payload.email);
  if (!email || !email.includes('@')) throw badRequest('email is required');
  const countries = requestedCountriesFromPayload(payload);
  if (!countries.length) throw badRequest('requested_country_codes is required');
  for (const country of countries) await assertCountryExists(country);
  const userId = await findUserIdByNormalizedEmail(email);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .select('id')
    .eq('email_normalized', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw conflict('A pending country legal access request already exists for this email');
  const { data, error } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .insert({
      email_normalized: email,
      requested_user_id: userId,
      requested_country_codes: countries,
      note: optionalNote(payload.note ?? payload.reason),
      status: 'pending',
      source: 'owner_invite',
    })
    .select('id')
    .single();
  if (error) {
    if (String(error.code) === '23505') throw conflict('A pending country legal access request already exists for this email');
    throw error;
  }
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_INVITATION_CREATED, 'owner_country_legal_access_request', data.id, {
    target_email: email,
    target_user_id: userId,
    country_codes: countries,
    capabilities: [],
    action: 'invitation_created',
  });
  return { ok: true, command: 'invite_country_legal_maintainer', refreshed: await refreshed(ctx) };
}

async function loadRequest(id: string) {
  const { data, error } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .select(
      'id, email_normalized, requested_user_id, requested_country_codes, note, status, source, decided_by_user_id, decided_at, created_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Access request not found');
  return data as {
    id: string;
    email_normalized: string;
    requested_user_id: string | null;
    requested_country_codes: string[];
    note: string | null;
    status: string;
    source: string;
  };
}

async function handleApprove(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  assertPlatformOwner(ctx);
  const request = await loadRequest(asUuid(payload.request_id, 'request_id'));
  if (request.status !== 'pending') throw conflict('Access request is not pending');
  const countries = requestedCountriesFromPayload(payload);
  if (!countries.length) throw badRequest('country_codes is required');
  const capabilities = normalizeGrantedCapabilities(payload.capabilities);
  if (!capabilities.length) throw badRequest('capabilities is required');
  if (!capabilities.includes('legal_knowledge.view')) {
    throw badRequest('legal_knowledge.view is required');
  }
  const userId = request.requested_user_id ?? (await findUserIdByNormalizedEmail(request.email_normalized));
  for (const country of countries) {
    await insertAssignment(ctx, {
      email: request.email_normalized,
      userId,
      countryCode: country,
      capabilities,
    });
  }
  const { error } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .update({
      status: 'approved',
      decided_by_user_id: ctx.user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('id', request.id)
    .eq('status', 'pending');
  if (error) throw error;
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ACCESS_REQUEST_APPROVED, 'owner_country_legal_access_request', request.id, {
    target_email: request.email_normalized,
    target_user_id: userId,
    country_codes: countries,
    capabilities,
    action: 'request_approved',
  });
  return { ok: true, command: 'approve_country_legal_access_request', refreshed: await refreshed(ctx) };
}

async function handleReject(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  assertPlatformOwner(ctx);
  const request = await loadRequest(asUuid(payload.request_id, 'request_id'));
  if (request.status !== 'pending') throw conflict('Access request is not pending');
  const { error } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .update({
      status: 'rejected',
      decided_by_user_id: ctx.user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('id', request.id)
    .eq('status', 'pending');
  if (error) throw error;
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ACCESS_REQUEST_REJECTED, 'owner_country_legal_access_request', request.id, {
    target_email: request.email_normalized,
    target_user_id: request.requested_user_id,
    country_codes: request.requested_country_codes,
    capabilities: [],
    action: 'request_rejected',
  });
  return { ok: true, command: 'reject_country_legal_access_request', refreshed: await refreshed(ctx) };
}

async function handleGrant(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  assertPlatformOwner(ctx);
  const email = normalizeOwnerLegalEmail(payload.email);
  if (!email || !email.includes('@')) throw badRequest('email is required');
  const countries = requestedCountriesFromPayload(payload);
  if (!countries.length) throw badRequest('country_code is required');
  const capabilities = normalizeGrantedCapabilities(payload.capabilities);
  if (!capabilities.length) throw badRequest('capabilities is required');
  const userId = await findUserIdByNormalizedEmail(email);
  for (const country of countries) {
    await insertAssignment(ctx, { email, userId, countryCode: country, capabilities });
  }
  return { ok: true, command: 'grant_country_legal_assignment', refreshed: await refreshed(ctx) };
}

async function loadAssignment(id: string): Promise<OwnerLegalAssignmentRow> {
  const { data, error } = await supabaseAdmin
    .from('owner_country_legal_assignments')
    .select(
      'id, email_normalized, user_id, country_code, capabilities, status, granted_by_user_id, granted_at, suspended_at, suspended_by_user_id, revoked_at, revoked_by_user_id, updated_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Country legal assignment not found');
  return data as OwnerLegalAssignmentRow;
}

async function handleUpdatePermissions(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  assertPlatformOwner(ctx);
  const row = await loadAssignment(asUuid(payload.assignment_id, 'assignment_id'));
  if (row.status === 'revoked') throw conflict('Revoked assignments cannot be updated');
  const capabilities = normalizeGrantedCapabilities(payload.capabilities);
  if (!capabilities.length) throw badRequest('capabilities is required');
  const previous = row.capabilities;
  const { data, error } = await supabaseAdmin
    .from('owner_country_legal_assignments')
    .update({ capabilities })
    .eq('id', row.id)
    .select(
      'id, email_normalized, user_id, country_code, capabilities, status, granted_by_user_id, granted_at, suspended_at, suspended_by_user_id, revoked_at, revoked_by_user_id, updated_at',
    )
    .single();
  if (error) throw error;
  await writeCapabilityAudits(ctx, data as OwnerLegalAssignmentRow, previous, true);
  return { ok: true, command: 'update_country_legal_assignment_permissions', refreshed: await refreshed(ctx) };
}

async function handleSuspend(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  assertPlatformOwner(ctx);
  const row = await loadAssignment(asUuid(payload.assignment_id, 'assignment_id'));
  if (row.status === 'revoked') throw conflict('Revoked assignments cannot be suspended');
  if (row.status === 'suspended') {
    return { ok: true, command: 'suspend_country_legal_assignment', refreshed: await refreshed(ctx) };
  }
  const { error } = await supabaseAdmin
    .from('owner_country_legal_assignments')
    .update({
      status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspended_by_user_id: ctx.user.id,
    })
    .eq('id', row.id);
  if (error) throw error;
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ASSIGNMENT_SUSPENDED, 'owner_country_legal_assignment', row.id, {
    target_email: row.email_normalized,
    target_user_id: row.user_id,
    country_code: row.country_code,
    capabilities: row.capabilities,
    action: 'assignment_suspended',
  });
  return { ok: true, command: 'suspend_country_legal_assignment', refreshed: await refreshed(ctx) };
}

async function handleRevoke(ctx: RequestContext, payload: Record<string, unknown>): Promise<AccessCommandResponse> {
  assertPlatformOwner(ctx);
  const row = await loadAssignment(asUuid(payload.assignment_id, 'assignment_id'));
  if (row.status === 'revoked') {
    return { ok: true, command: 'revoke_country_legal_assignment', refreshed: await refreshed(ctx) };
  }
  const { error } = await supabaseAdmin
    .from('owner_country_legal_assignments')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: ctx.user.id,
    })
    .eq('id', row.id);
  if (error) throw error;
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_ASSIGNMENT_REVOKED, 'owner_country_legal_assignment', row.id, {
    target_email: row.email_normalized,
    target_user_id: row.user_id,
    country_code: row.country_code,
    capabilities: row.capabilities,
    action: 'assignment_revoked',
  });
  await auditAccess(ctx, AUDIT_ACTIONS.OWNER_COUNTRY_LEGAL_COUNTRY_REMOVED, 'owner_country_legal_assignment', row.id, {
    target_email: row.email_normalized,
    target_user_id: row.user_id,
    country_code: row.country_code,
    capabilities: row.capabilities,
    action: 'country_removed',
  });
  return { ok: true, command: 'revoke_country_legal_assignment', refreshed: await refreshed(ctx) };
}

export async function executeOwnerCountryLegalAccessCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<AccessCommandResponse> {
  if (!isOwnerCountryLegalAccessCommand(command)) {
    throw badRequest(`Unsupported country legal access command: ${command || 'unknown'}`);
  }
  switch (command) {
    case 'request_country_legal_access':
      return handleRequest(ctx, payload);
    case 'invite_country_legal_maintainer':
      return handleInvite(ctx, payload);
    case 'approve_country_legal_access_request':
      return handleApprove(ctx, payload);
    case 'reject_country_legal_access_request':
      return handleReject(ctx, payload);
    case 'grant_country_legal_assignment':
      return handleGrant(ctx, payload);
    case 'update_country_legal_assignment_permissions':
      return handleUpdatePermissions(ctx, payload);
    case 'suspend_country_legal_assignment':
      return handleSuspend(ctx, payload);
    case 'revoke_country_legal_assignment':
      return handleRevoke(ctx, payload);
    default:
      throw badRequest(`Unsupported country legal access command: ${command}`);
  }
}
