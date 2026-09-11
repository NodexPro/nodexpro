import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  OWNER_COUNTRY_LEGAL_CAPABILITIES,
  OWNER_COUNTRY_LEGAL_CAPABILITY_LABELS,
} from './owner-country-legal-access.types.js';
import { buildOwnerWorkspaceNavigation, normalizeOwnerLegalEmail } from './owner-country-legal-access.pure.js';
import {
  loadOwnerLegalAssignments,
  ownerLegalActivationPolicy,
  type OwnerLegalActor,
  type OwnerLegalAssignmentRow,
} from './owner-country-legal-access.service.js';

type AccessRequestRow = {
  id: string;
  email_normalized: string;
  requested_user_id: string | null;
  requested_country_codes: string[];
  note: string | null;
  status: string;
  source: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
  created_at: string;
};

async function loadUsersByIds(ids: string[]): Promise<Map<string, { id: string; email: string | null; full_name: string | null }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, { id: string; email: string | null; full_name: string | null }>();
  if (!unique.length) return map;
  const { data, error } = await supabaseAdmin.from('users').select('id, email, full_name').in('id', unique);
  if (error) throw error;
  for (const row of data ?? []) {
    map.set(String(row.id), {
      id: String(row.id),
      email: typeof row.email === 'string' ? row.email : null,
      full_name: typeof row.full_name === 'string' ? row.full_name : null,
    });
  }
  return map;
}

export async function loadOwnerCountryLegalAccessRequests(status?: string): Promise<AccessRequestRow[]> {
  let query = supabaseAdmin
    .from('owner_country_legal_access_requests')
    .select(
      'id, email_normalized, requested_user_id, requested_country_codes, note, status, source, decided_by_user_id, decided_at, created_at',
    )
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error && isSupabaseMissingTableError(error, 'owner_country_legal_access_requests')) return [];
  if (error) throw error;
  return (data ?? []) as AccessRequestRow[];
}

function mapAssignment(
  row: OwnerLegalAssignmentRow,
  users: Map<string, { id: string; email: string | null; full_name: string | null }>,
) {
  const granted = row.granted_by_user_id ? users.get(row.granted_by_user_id) : null;
  const assigned = row.user_id ? users.get(row.user_id) : null;
  return {
    assignment_id: row.id,
    email: row.email_normalized,
    name: assigned?.full_name ?? null,
    user_id: row.user_id,
    country_code: row.country_code,
    capabilities: row.capabilities,
    status: row.status,
    granted_by: granted?.email ?? row.granted_by_user_id,
    granted_at: row.granted_at,
    last_changed: row.updated_at,
    suspended_at: row.suspended_at,
    revoked_at: row.revoked_at,
  };
}

export async function buildOwnerCountryLegalAccessAdminSlice(): Promise<Record<string, unknown>> {
  const [pending, assignments] = await Promise.all([
    loadOwnerCountryLegalAccessRequests('pending'),
    loadOwnerLegalAssignments(),
  ]);
  const userIds = [
    ...pending.map((row) => row.requested_user_id ?? ''),
    ...assignments.map((row) => row.user_id ?? ''),
    ...assignments.map((row) => row.granted_by_user_id),
  ];
  const users = await loadUsersByIds(userIds);
  const expertsByEmail = new Map<
    string,
    {
      email: string;
      name: string | null;
      user_id: string | null;
      assignments: ReturnType<typeof mapAssignment>[];
    }
  >();
  for (const row of assignments) {
    const current = expertsByEmail.get(row.email_normalized) ?? {
      email: row.email_normalized,
      name: row.user_id ? users.get(row.user_id)?.full_name ?? null : null,
      user_id: row.user_id,
      assignments: [],
    };
    current.assignments.push(mapAssignment(row, users));
    expertsByEmail.set(row.email_normalized, current);
  }

  return {
    aggregate_key: 'owner_country_legal_access_aggregate',
    capability_catalog: OWNER_COUNTRY_LEGAL_CAPABILITIES.map((code) => ({
      code,
      label: OWNER_COUNTRY_LEGAL_CAPABILITY_LABELS[code],
      is_activation: code === 'legal_knowledge.activate',
      default_granted: false,
    })),
    pending_requests: pending.map((row) => ({
      request_id: row.id,
      email: row.email_normalized,
      requested_country_codes: row.requested_country_codes,
      note: row.note,
      status: row.status,
      source: row.source,
      requested_at: row.created_at,
    })),
    experts: [...expertsByEmail.values()],
    assignments: assignments.map((row) => mapAssignment(row, users)),
    available_actions: [
      { action_key: 'invite_country_legal_maintainer', enabled: true },
      { action_key: 'approve_country_legal_access_request', enabled: true },
      { action_key: 'reject_country_legal_access_request', enabled: true },
      { action_key: 'grant_country_legal_assignment', enabled: true },
      { action_key: 'update_country_legal_assignment_permissions', enabled: true },
      { action_key: 'suspend_country_legal_assignment', enabled: true },
      { action_key: 'revoke_country_legal_assignment', enabled: true },
    ],
  };
}

export async function buildPendingRequesterPanel(ctx: RequestContext): Promise<Record<string, unknown>> {
  const email = normalizeOwnerLegalEmail(ctx.user.email);
  const { data, error } = await supabaseAdmin
    .from('owner_country_legal_access_requests')
    .select('id, email_normalized, requested_country_codes, note, status, created_at')
    .eq('email_normalized', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (error && isSupabaseMissingTableError(error, 'owner_country_legal_access_requests')) {
    return {
      aggregate_key: 'owner_legal_control_panel_aggregate',
      actor: {
        kind: 'pending_requester',
        email,
        assigned_countries: [],
        capabilities_by_country: {},
        activation_policy: ownerLegalActivationPolicy(),
      },
      owner_workspace_navigation: [],
      country_legal_access: { my_pending_request: null },
      countries: [],
      tax_knowledge: { selected_country_code: null, countries: [], sources: [], rules: [], allowed_actions: [], warnings: [] },
      available_actions: { tax_knowledge: [], legal_values: [], strategy_engine: [], fact_dictionary: [] },
    };
  }
  if (error) throw error;
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    actor: {
      kind: 'pending_requester',
      email,
      assigned_countries: [],
      capabilities_by_country: {},
      activation_policy: ownerLegalActivationPolicy(),
    },
    owner_workspace_navigation: [],
    country_legal_access: {
      my_pending_request: data
        ? {
            request_id: data.id,
            email: data.email_normalized,
            requested_country_codes: data.requested_country_codes,
            note: data.note,
            status: data.status,
            requested_at: data.created_at,
          }
        : null,
    },
    countries: [],
    tax_knowledge: { selected_country_code: null, countries: [], sources: [], rules: [], allowed_actions: [], warnings: [] },
    available_actions: { tax_knowledge: [], legal_values: [], strategy_engine: [], fact_dictionary: [] },
  };
}

export function actorPanelFields(actor: OwnerLegalActor) {
  return {
    actor: {
      kind: actor.kind,
      email: actor.email,
      assigned_countries: actor.kind === 'platform_owner' ? [] : Object.keys(actor.capabilitiesByCountry).sort(),
      capabilities_by_country: actor.kind === 'platform_owner' ? {} : actor.capabilitiesByCountry,
      activation_policy: ownerLegalActivationPolicy(),
    },
    owner_workspace_navigation: buildOwnerWorkspaceNavigation(actor.kind),
  };
}
