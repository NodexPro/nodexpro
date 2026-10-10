/**
 * Stage 5.6 — Users & Roles: pure projection rules.
 *
 * Everything the screen needs to render is decided here (backend) and returned as UI-ready values.
 * The frontend never derives an action, label or summary from a role code.
 *
 * Display name fallback is presentation only and is NEVER written back into the structured profile:
 *   structured first/last name → users.full_name → email
 */

import {
  allClientsSummaryFor,
  allOfficeModulesSummaryFor,
  invitationStatusLabelFor,
  memberStatusLabelFor,
  noModulesSummaryFor,
  roleLabelFor,
  selectedClientsSummaryFor,
  type UsersRolesLocale,
} from './users-roles-locale.pure.js';

export type MemberProfileInput = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

export type MemberProfileNormalization =
  | { ok: true; patch: Record<'first_name' | 'last_name' | 'phone', string | null | undefined> }
  | { ok: false; code: string; message: string };

const NAME_MAX = 80;
const PHONE_MIN = 5;
const PHONE_MAX = 32;

/** Collapse internal whitespace and trim. Empty → null. */
export function normalizeOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/**
 * `undefined` = field not part of the command (unchanged). `null`/empty = clear the field.
 * Limits mirror the migration 187 check constraints.
 */
export function normalizeMemberProfileInput(body: unknown): MemberProfileNormalization {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: Record<'first_name' | 'last_name' | 'phone', string | null | undefined> = {
    first_name: undefined,
    last_name: undefined,
    phone: undefined,
  };
  for (const field of ['first_name', 'last_name'] as const) {
    if (raw[field] === undefined) continue;
    const value = normalizeOptionalText(raw[field]);
    if (value !== null && value.length > NAME_MAX) {
      return { ok: false, code: 'MEMBER_PROFILE_NAME_TOO_LONG', message: `${field} is too long` };
    }
    patch[field] = value;
  }
  if (raw.phone !== undefined) {
    const phone = normalizeOptionalText(raw.phone);
    if (phone !== null) {
      if (phone.length < PHONE_MIN || phone.length > PHONE_MAX) {
        return { ok: false, code: 'MEMBER_PROFILE_PHONE_INVALID', message: 'Phone number is not valid' };
      }
      if (!/^[0-9+()\-.\s]+$/.test(phone)) {
        return { ok: false, code: 'MEMBER_PROFILE_PHONE_INVALID', message: 'Phone number is not valid' };
      }
    }
    patch.phone = phone;
  }
  if (patch.first_name === undefined && patch.last_name === undefined && patch.phone === undefined) {
    return { ok: false, code: 'MEMBER_PROFILE_EMPTY_COMMAND', message: 'No profile field provided' };
  }
  return { ok: true, patch };
}

export function resolveMemberDisplayName(params: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
  const structured = [params.firstName, params.lastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (structured) return structured;
  const fullName = String(params.fullName ?? '').trim();
  if (fullName) return fullName;
  return String(params.email ?? '').trim();
}

/** YYYY-MM-DD in the organization's timezone (no time, no zone noise). */
export function toDateOnly(iso: string | null | undefined, timeZone?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export type MemberStatusCode = 'active' | 'invited' | 'access_closed';

export function resolveMemberStatus(
  membershipStatus: string,
  locale: UsersRolesLocale = 'en',
): { code: MemberStatusCode; label: string } {
  const status = String(membershipStatus ?? '').trim().toLowerCase();
  const code: MemberStatusCode = status === 'active' ? 'active' : status === 'invited' ? 'invited' : 'access_closed';
  return { code, label: memberStatusLabelFor(code, locale) };
}

export function resolveRoleLabel(roleCode: string, locale: UsersRolesLocale = 'en'): string {
  return roleLabelFor(roleCode, locale);
}

export function resolveInvitationStatus(
  status: string,
  locale: UsersRolesLocale = 'en',
): { code: 'invited' | 'accepted' | 'expired' | 'cancelled'; label: string } {
  const s = String(status ?? '').trim().toLowerCase();
  const code = s === 'pending' ? 'invited' : s === 'accepted' ? 'accepted' : s === 'expired' ? 'expired' : 'cancelled';
  return { code, label: invitationStatusLabelFor(code, locale) };
}

export type ClientAccessProjection = {
  /** false for Owner/Admin: office-wide access, nothing to configure. */
  applicable: boolean;
  mode: 'all' | 'selected';
  selected_count: number;
  summary: string;
};

export function buildClientAccessProjection(params: {
  applicable: boolean;
  policyMode: string | null | undefined;
  activeGrantCount: number;
  locale?: UsersRolesLocale;
}): ClientAccessProjection {
  const locale = params.locale ?? 'en';
  if (!params.applicable) {
    return { applicable: false, mode: 'all', selected_count: 0, summary: allClientsSummaryFor(locale) };
  }
  if (String(params.policyMode ?? '').trim().toLowerCase() === 'all') {
    return { applicable: true, mode: 'all', selected_count: 0, summary: allClientsSummaryFor(locale) };
  }
  // Missing policy fails closed to "selected, none" — same as the Stage 5.1 resolver.
  const count = Math.max(0, Math.floor(params.activeGrantCount) || 0);
  return {
    applicable: true,
    mode: 'selected',
    selected_count: count,
    summary: selectedClientsSummaryFor(count, locale),
  };
}

export type ModuleAccessProjection = {
  applicable: boolean;
  enabled_modules: Array<{ module_id: string; name: string }>;
  summary: string;
};

export function buildModuleAccessProjection(params: {
  applicable: boolean;
  enabledModules: ReadonlyArray<{ module_id: string; name: string }>;
  locale?: UsersRolesLocale;
}): ModuleAccessProjection {
  const locale = params.locale ?? 'en';
  if (!params.applicable) {
    return { applicable: false, enabled_modules: [], summary: allOfficeModulesSummaryFor(locale) };
  }
  const enabled = [...params.enabledModules];
  return {
    applicable: true,
    enabled_modules: enabled,
    summary: enabled.length === 0 ? noModulesSummaryFor(locale) : enabled.map((m) => m.name).join(', '),
  };
}

export type MemberActions = {
  edit_profile: boolean;
  manage_clients: boolean;
  manage_modules: boolean;
  close_access: boolean;
  /** Role change stays display-only until a named, ACL-aware command exists. */
  change_role: boolean;
};

const NO_ACTIONS: MemberActions = {
  edit_profile: false,
  manage_clients: false,
  manage_modules: false,
  close_access: false,
  change_role: false,
};

/**
 * Backend decision of which management actions apply to ONE row for THIS actor.
 * Mirrors the authorization the commands themselves enforce (direct API stays authoritative).
 */
export function computeMemberActions(params: {
  actorRoleCode: string | null | undefined;
  /** Resolved by the service from the actor's permission set (members:write). */
  actorCanWriteMembers: boolean;
  /** Resolved by the service from the actor's permission set (members:revoke). */
  actorCanRevokeAccess: boolean;
  actorUserId: string;
  targetRoleCode: string;
  targetStatus: string;
  targetUserId: string;
}): MemberActions {
  const actorRole = String(params.actorRoleCode ?? '').trim().toLowerCase();
  const actorIsOffice = actorRole === 'owner' || actorRole === 'admin';
  if (!actorIsOffice) return { ...NO_ACTIONS };

  const targetRole = String(params.targetRoleCode ?? '').trim().toLowerCase();
  const targetActive = String(params.targetStatus ?? '').trim().toLowerCase() === 'active';
  const isSelf = params.targetUserId === params.actorUserId;
  const targetIsEmployee = targetRole === 'staff' || targetRole === 'viewer';

  const canWriteMembers = params.actorCanWriteMembers;
  const canRevoke = params.actorCanRevokeAccess;

  return {
    // Only an Owner edits the Owner's profile.
    edit_profile: canWriteMembers && targetActive && (targetRole !== 'owner' || actorRole === 'owner'),
    manage_clients: canWriteMembers && targetActive && targetIsEmployee,
    manage_modules: canWriteMembers && targetActive && targetIsEmployee,
    close_access: canRevoke && targetActive && targetRole !== 'owner' && !isSelf,
    change_role: false,
  };
}

export type CloseAccessBlockers = {
  handler_client_count: number;
  open_todo_count: number;
};

export function hasCloseAccessBlockers(blockers: CloseAccessBlockers): boolean {
  return blockers.handler_client_count > 0 || blockers.open_todo_count > 0;
}
