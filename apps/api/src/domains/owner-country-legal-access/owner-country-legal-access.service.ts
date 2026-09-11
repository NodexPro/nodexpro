import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import { isPlatformOwnerContext } from '../../shared/platform-owner.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  evaluateOwnerLegalCommandAccess,
  maskActionsForCapabilities,
  normalizeOwnerLegalEmail,
} from './owner-country-legal-access.pure.js';
import { resolveCountryForOwnerLegalCommand } from './owner-country-legal-access-country-resolve.service.js';
import {
  OWNER_LEGAL_ACCESS_ERROR_CODES,
  type OwnerCountryLegalCapability,
  type OwnerLegalActorKind,
} from './owner-country-legal-access.types.js';

export type OwnerLegalAssignmentRow = {
  id: string;
  email_normalized: string;
  user_id: string | null;
  country_code: string;
  capabilities: string[];
  status: 'active' | 'suspended' | 'revoked';
  granted_by_user_id: string;
  granted_at: string;
  suspended_at: string | null;
  suspended_by_user_id: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  updated_at: string;
};

export type OwnerLegalActor = {
  kind: OwnerLegalActorKind;
  email: string;
  userId: string;
  capabilitiesByCountry: Record<string, string[]>;
  assignments: OwnerLegalAssignmentRow[];
};

function assignmentMatchesCaller(row: OwnerLegalAssignmentRow, ctx: RequestContext, email: string): boolean {
  if (row.user_id && row.user_id !== ctx.user.id) return false;
  if (row.user_id === ctx.user.id) return true;
  return row.email_normalized === email;
}

export async function loadOwnerLegalAssignments(filters?: {
  email?: string;
  userId?: string;
  statuses?: Array<'active' | 'suspended' | 'revoked'>;
}): Promise<OwnerLegalAssignmentRow[]> {
  let query = supabaseAdmin
    .from('owner_country_legal_assignments')
    .select(
      'id, email_normalized, user_id, country_code, capabilities, status, granted_by_user_id, granted_at, suspended_at, suspended_by_user_id, revoked_at, revoked_by_user_id, updated_at',
    )
    .order('granted_at', { ascending: false });
  if (filters?.email) query = query.eq('email_normalized', filters.email);
  if (filters?.userId) query = query.eq('user_id', filters.userId);
  if (filters?.statuses?.length) query = query.in('status', filters.statuses);
  const { data, error } = await query;
  if (error && isSupabaseMissingTableError(error, 'owner_country_legal_assignments')) return [];
  if (error) throw error;
  return (data ?? []) as OwnerLegalAssignmentRow[];
}

async function linkAssignmentsToUser(ctx: RequestContext, email: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('owner_country_legal_assignments')
    .update({ user_id: ctx.user.id })
    .eq('email_normalized', email)
    .is('user_id', null)
    .in('status', ['active', 'suspended']);
  if (error && !isSupabaseMissingTableError(error, 'owner_country_legal_assignments')) throw error;

  const { error: requestError } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .update({ requested_user_id: ctx.user.id })
    .eq('email_normalized', email)
    .is('requested_user_id', null);
  if (requestError && !isSupabaseMissingTableError(requestError, 'owner_country_legal_access_requests')) throw requestError;
}

export async function loadOwnerLegalActor(ctx: RequestContext): Promise<OwnerLegalActor | null> {
  const email = normalizeOwnerLegalEmail(ctx.user.email);
  if (isPlatformOwnerContext(ctx)) {
    return {
      kind: 'platform_owner',
      email,
      userId: ctx.user.id,
      capabilitiesByCountry: {},
      assignments: [],
    };
  }
  if (!email) return null;
  await linkAssignmentsToUser(ctx, email);
  const rows = await loadOwnerLegalAssignments({ statuses: ['active', 'suspended', 'revoked'] });
  const mine = rows.filter((row) => assignmentMatchesCaller(row, ctx, email));
  const active = mine.filter((row) => row.status === 'active');
  if (!active.length) return null;
  const capabilitiesByCountry: Record<string, string[]> = {};
  for (const row of active) {
    capabilitiesByCountry[row.country_code] = Array.isArray(row.capabilities) ? row.capabilities : [];
  }
  return {
    kind: 'country_legal_maintainer',
    email,
    userId: ctx.user.id,
    capabilitiesByCountry,
    assignments: mine,
  };
}

export async function requireOwnerLegalWorkspaceActor(ctx: RequestContext): Promise<OwnerLegalActor> {
  const actor = await loadOwnerLegalActor(ctx);
  if (!actor) {
    throw forbidden('Owner legal workspace access required', OWNER_LEGAL_ACCESS_ERROR_CODES.ACCESS_REQUIRED);
  }
  return actor;
}

export async function assertOwnerLegalReadAccess(
  ctx: RequestContext,
  countryCode?: string | null,
): Promise<OwnerLegalActor> {
  const actor = await requireOwnerLegalWorkspaceActor(ctx);
  if (countryCode && actor.kind !== 'platform_owner') {
    const caps = actor.capabilitiesByCountry[countryCode] ?? [];
    if (!caps.includes('legal_knowledge.view')) {
      throw forbidden('Country legal access is not granted for this country', OWNER_LEGAL_ACCESS_ERROR_CODES.COUNTRY_FORBIDDEN);
    }
  }
  return actor;
}

export async function assertOwnerLegalCommandAccess(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<OwnerLegalActor> {
  const actor = await loadOwnerLegalActor(ctx);
  if (!actor) {
    throw forbidden('Owner legal workspace access required', OWNER_LEGAL_ACCESS_ERROR_CODES.ACCESS_REQUIRED);
  }
  const countryCode = await resolveCountryForOwnerLegalCommand(command, payload);
  const decision = evaluateOwnerLegalCommandAccess(
    {
      kind: actor.kind,
      capabilitiesByCountry: actor.capabilitiesByCountry,
    },
    command,
    countryCode,
  );
  if (!decision.ok) {
    const message =
      decision.code === 'OWNER_LEGAL_ACTIVATE_REQUIRED'
        ? 'Activate/Publish permission is required for this country'
        : decision.code === 'OWNER_LEGAL_COUNTRY_REQUIRED'
          ? 'Country scope is required'
          : decision.code === 'PLATFORM_OWNER_REQUIRED'
            ? 'Platform owner access required'
            : 'Country legal capability is required';
    throw forbidden(message, decision.code);
  }
  return actor;
}

export function actorAssignedCountryCodes(actor: OwnerLegalActor): string[] | null {
  if (actor.kind === 'platform_owner') return null;
  return Object.keys(actor.capabilitiesByCountry).sort();
}

export function actorCapabilitiesForCountry(actor: OwnerLegalActor, countryCode: string | null): string[] {
  if (actor.kind === 'platform_owner') {
    return [
      'legal_knowledge.view',
      'legal_knowledge.draft_create',
      'legal_knowledge.draft_edit',
      'legal_knowledge.review',
      'legal_sources.manage',
      'legal_values.manage',
      'fact_dictionary.manage',
      'legal_knowledge.activate',
    ];
  }
  if (!countryCode) return [];
  return actor.capabilitiesByCountry[countryCode] ?? [];
}

export function filterCountryRows<T extends { country_code?: unknown; code?: unknown }>(
  rows: T[],
  allowed: string[] | null,
  field: 'country_code' | 'code' = 'country_code',
): T[] {
  if (!allowed) return rows;
  const set = new Set(allowed);
  return rows.filter((row) => {
    const raw = field === 'code' ? row.code : row.country_code;
    return typeof raw === 'string' && set.has(raw.trim().toUpperCase());
  });
}

export function maskPanelActions(
  actions: Array<{ action_key?: unknown; enabled?: unknown }>,
  actor: OwnerLegalActor,
  countryCode: string | null,
): Array<{ action_key?: unknown; enabled?: unknown }> {
  if (actor.kind === 'platform_owner') return actions;
  return maskActionsForCapabilities(actions, actorCapabilitiesForCountry(actor, countryCode), false);
}

export function ownerLegalActivationPolicy() {
  return {
    step_up_required: false,
    required_capability: 'legal_knowledge.activate' as const,
    note: 'Later MFA / re-authentication can be required here without changing capability codes.',
  };
}

export function capabilitiesInclude(capabilities: string[], code: OwnerCountryLegalCapability): boolean {
  return capabilities.includes(code);
}
