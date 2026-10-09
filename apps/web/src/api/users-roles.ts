/**
 * Users & Roles — thin transport + types.
 *
 * Strict rules (Stage 5.6):
 *   - Every visible value, count, label and action comes from the backend aggregate.
 *   - The UI sends named commands only; each command returns refreshed backend truth.
 *   - No role/permission logic lives here. Actions are rendered from `available_actions`.
 *
 * Source of truth: apps/api/src/domains/memberships/users-roles-aggregate.service.ts
 * (endpoints.ts is intentionally untouched: these routes belong to this module.)
 */

import { apiJson } from './client';

const base = (orgId: string) => `/organizations/${orgId}`;

export type UsersRolesMemberActions = {
  edit_profile: boolean;
  manage_clients: boolean;
  manage_modules: boolean;
  close_access: boolean;
  change_role: boolean;
};

export type UsersRolesMemberRow = {
  member_id: string;
  user_id: string;
  profile: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    display_name: string;
    email: string | null;
  };
  role: { code: string; label: string };
  membership: { status: { code: string; label: string }; start_date: string | null };
  client_access: { applicable: boolean; mode: 'all' | 'selected'; selected_count: number; summary: string };
  module_access: {
    applicable: boolean;
    enabled_modules: Array<{ module_id: string; name: string }>;
    summary: string;
  };
  close_access: {
    blockers: { handler_client_count: number; open_todo_count: number };
    blocked: boolean;
  } | null;
  is_self: boolean;
  available_actions: UsersRolesMemberActions;
};

export type UsersRolesInvitationRow = {
  invitation_id: string;
  email: string;
  role: { code: string; label: string };
  status: { code: string; label: string };
  send_count: number;
  last_sent_date: string | null;
  available_actions: { resend: boolean; cancel: boolean };
};

export type UsersRolesAggregate = {
  aggregate_key: 'users_roles_aggregate';
  organization_id: string;
  available_actions: { invite_member: boolean };
  invite_roles: Array<{ code: string; label: string }>;
  members: UsersRolesMemberRow[];
  invitations: UsersRolesInvitationRow[];
};

export type MemberClientAccessEditorAggregate = {
  aggregate_key: 'member_client_access_editor';
  organization_id: string;
  member: { member_id: string; display_name: string; role_label: string };
  access_mode: 'all' | 'selected';
  selected_client_ids: string[];
  selected_client_count: number;
  clients: Array<{ client_id: string; display_name: string; tax_id: string | null }>;
  catalog_truncated: boolean;
};

export type MemberModuleAssignabilityAggregate = {
  aggregate_key: 'member_module_assignability';
  organization_id: string;
  membership_id: string;
  role_code: string;
  member_display_name: string;
  applicable: boolean;
  modules: Array<{
    module_id: string;
    code: string;
    display_name: string;
    organization_entitled: boolean;
    member_assignable: boolean;
    member_enabled: boolean;
    navigation_available: boolean;
  }>;
};

export type MemberProfilePayload = {
  first_name: string;
  last_name: string;
  phone: string;
};

export const fetchUsersRolesAggregate = (orgId: string) =>
  apiJson<UsersRolesAggregate>(`${base(orgId)}/aggregates/users-roles`);

export const setMemberProfileCommand = (orgId: string, memberId: string, payload: MemberProfilePayload) =>
  apiJson<UsersRolesAggregate>(`${base(orgId)}/members/${memberId}/commands/set_member_profile`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const closeMemberAccessCommand = (orgId: string, memberId: string) =>
  apiJson<UsersRolesAggregate>(`${base(orgId)}/members/${memberId}/commands/close_member_access`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const fetchMemberClientAccessEditor = (orgId: string, memberId: string) =>
  apiJson<MemberClientAccessEditorAggregate>(`${base(orgId)}/members/${memberId}/aggregates/client-access`);

export const setMemberClientAccessCommand = (
  orgId: string,
  memberId: string,
  payload: { access_mode: 'all' | 'selected'; selected_client_ids: string[] },
) =>
  apiJson<{ users_roles_aggregate: UsersRolesAggregate }>(
    `${base(orgId)}/members/${memberId}/commands/set_member_client_access`,
    { method: 'POST', body: JSON.stringify(payload) },
  );

export const fetchMemberModuleAssignability = (orgId: string, memberId: string) =>
  apiJson<MemberModuleAssignabilityAggregate>(`${base(orgId)}/members/${memberId}/aggregates/module-assignability`);

export const setMemberModuleAccessCommand = (orgId: string, memberId: string, moduleIds: string[]) =>
  apiJson<{
    users_roles_aggregate: UsersRolesAggregate;
    module_assignability_aggregate: MemberModuleAssignabilityAggregate;
  }>(`${base(orgId)}/members/${memberId}/commands/set_member_module_access`, {
    method: 'POST',
    body: JSON.stringify({ enabled_modules: moduleIds }),
  });
