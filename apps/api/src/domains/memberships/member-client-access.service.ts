/**
 * Named command: set Staff/Viewer client visibility.
 * Does not write the handler column.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  canManageMemberClientAccess,
  normalizeMemberClientAccessCommand,
} from '../client-operations/organization-client-access.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MemberClientAccessAggregate = {
  aggregate_key: 'member_client_access';
  organization_id: string;
  membership_id: string;
  user_id: string;
  role_code: string;
  status: string;
  access_mode: 'all' | 'selected';
  selected_client_ids: string[];
  selected_client_count: number;
};

function mapRpcError(message: string): AppError {
  if (message.includes('MEMBER_CLIENT_ACCESS_FORBIDDEN')) {
    return forbidden('Only Owner or Admin may set client access', 'MEMBER_CLIENT_ACCESS_FORBIDDEN');
  }
  if (message.includes('MEMBER_CLIENT_ACCESS_CROSS_ORG_MEMBER')) {
    return forbidden('Member not found', 'MEMBER_CLIENT_ACCESS_FORBIDDEN');
  }
  if (message.includes('MEMBER_CLIENT_ACCESS_TARGET_INACTIVE')) {
    return badRequest('Target membership is not active', 'MEMBER_CLIENT_ACCESS_TARGET_INACTIVE');
  }
  if (message.includes('MEMBER_CLIENT_ACCESS_TARGET_ROLE')) {
    return forbidden('Client access policy applies to Staff and Viewer only', 'MEMBER_CLIENT_ACCESS_TARGET_ROLE');
  }
  if (message.includes('MEMBER_CLIENT_ACCESS_MODE')) {
    return badRequest('access_mode must be all or selected', 'MEMBER_CLIENT_ACCESS_MODE');
  }
  if (
    message.includes('MEMBER_CLIENT_ACCESS_CROSS_ORG_CLIENT') ||
    message.includes('MEMBER_CLIENT_ACCESS_ARCHIVED_CLIENT') ||
    message.includes('MEMBER_CLIENT_ACCESS_UNKNOWN_CLIENT')
  ) {
    return forbidden('Client not found', 'MEMBER_CLIENT_ACCESS_CLIENT');
  }
  return new AppError(500, message || 'Failed to set client access', 'MEMBER_CLIENT_ACCESS_FAILED');
}

export function normalizeMemberClientAccessInput(body: unknown): {
  accessMode: 'all' | 'selected';
  selectedClientIds: string[];
} {
  const raw = (body ?? {}) as { access_mode?: unknown; selected_client_ids?: unknown };
  const normalized = normalizeMemberClientAccessCommand(raw);
  if ('error' in normalized) {
    const code = normalized.error.includes('UUID')
      ? 'MEMBER_CLIENT_ACCESS_CLIENT'
      : normalized.error.includes('Too many')
        ? 'MEMBER_CLIENT_ACCESS_TOO_MANY'
        : 'MEMBER_CLIENT_ACCESS_MODE';
    throw badRequest(normalized.error, code);
  }
  return normalized;
}

export async function setMemberClientAccess(
  ctx: RequestContext,
  orgId: string,
  membershipId: string,
  body: unknown,
): Promise<MemberClientAccessAggregate> {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  if (!canManageMemberClientAccess(ctx.membership?.roleCode)) {
    throw forbidden('Only Owner or Admin may set client access', 'MEMBER_CLIENT_ACCESS_FORBIDDEN');
  }
  const targetId = String(membershipId ?? '').trim().toLowerCase();
  if (!UUID_RE.test(targetId)) throw forbidden('Member not found');
  const input = normalizeMemberClientAccessInput(body);

  const { data, error } = await supabaseAdmin.rpc('set_organization_member_client_access', {
    p_organization_id: orgId,
    p_actor_user_id: ctx.user.id,
    p_membership_id: targetId,
    p_access_mode: input.accessMode,
    p_selected_client_ids: input.selectedClientIds,
  });
  if (error) throw mapRpcError(String(error.message ?? ''));
  const row = (data ?? {}) as MemberClientAccessAggregate;
  return {
    aggregate_key: 'member_client_access',
    organization_id: String(row.organization_id ?? orgId),
    membership_id: String(row.membership_id ?? targetId),
    user_id: String(row.user_id ?? ''),
    role_code: String(row.role_code ?? ''),
    status: String(row.status ?? ''),
    access_mode: row.access_mode === 'all' ? 'all' : 'selected',
    selected_client_ids: Array.isArray(row.selected_client_ids) ? row.selected_client_ids.map(String) : [],
    selected_client_count: Number(row.selected_client_count ?? 0),
  };
}
