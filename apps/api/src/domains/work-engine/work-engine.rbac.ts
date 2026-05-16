import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import { hasPermission } from '../rbac/rbac.service.js';

export const WORK_ENGINE_PERMISSIONS = {
  view: 'work_engine.view',
  write: 'work_engine.write',
  assign: 'work_engine.assign',
  pickup: 'work_engine.pickup',
  claim: 'work_engine.claim',
  claimForce: 'work_engine.claim.force',
  override: 'work_engine.override',
  admin: 'work_engine.admin',
  reviewRequest: 'work_engine.review.request',
  reviewApprove: 'work_engine.review.approve',
  reviewReject: 'work_engine.review.reject',
  reviewBreakGlass: 'work_engine.review.break_glass',
  escalationEscalate: 'work_engine.escalation.escalate',
  escalationAcknowledge: 'work_engine.escalation.acknowledge',
  escalationResolve: 'work_engine.escalation.resolve',
  escalationReassign: 'work_engine.escalation.reassign',
} as const;

export function requireWorkEnginePermission(ctx: RequestContext, permissionCode: string): void {
  if (!ctx.membership) throw forbidden('Organization membership required');
  if (!hasPermission(ctx.membership.permissions ?? [], permissionCode)) {
    throw forbidden('Insufficient permission');
  }
}
