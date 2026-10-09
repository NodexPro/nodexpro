import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { requireOfficeAdministration } from '../../middleware/requireOfficeAdministration.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as membershipsRbac from './memberships-rbac.service.js';
import { setMemberClientAccess } from './member-client-access.service.js';
import {
  buildMemberClientAccessEditorAggregate,
  buildUsersRolesAggregate,
  closeMemberAccess,
  setMemberProfile,
} from './users-roles-aggregate.service.js';
import { buildMemberModuleAssignabilityAggregate, setMemberModuleAccess } from '../modules/member-module-access.service.js';

const router = Router();
// Support both RBAC and legacy permission codes
const withViewUsers = [authMiddleware, requireOrg, requireOfficeAdministration, requirePermission('view_users', 'members:read')];

// High-risk mutations: add abuse protection (per actor + route bucket).
const withInvite = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 15,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission('invite_users', 'members:write'),
];

const withChangeRole = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission('change_user_role', 'members:write'),
];

const withSetClientAccess = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission('members:write'),
];

const withSetModuleAccess = withSetClientAccess;

const withRevoke = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission('revoke_user_access', 'members:revoke'),
];

router.get('/:id/members', ...withViewUsers, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const list = await membershipsRbac.listMembersRbac(req.context!, req.params.id);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

/** Billing-owned staff seat entitlement truth for office UI (render-only). */
router.get('/:id/staff-seat-entitlement', ...withViewUsers, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    const { resolveStaffSeatEntitlement } = await import('../modules/staff-seat-entitlement.service.js');
    const seats = await resolveStaffSeatEntitlement(req.params.id);
    return res.json({
      aggregate_key: 'organization_staff_seat_entitlement_aggregate',
      organization_id: req.params.id,
      staff_seats: seats,
      seats_used_label: `${seats.active_consumed_staff_seats} / ${seats.entitled_staff_seats}`,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/members/invite', ...withInvite, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const { email, role_code } = req.body ?? {};
    const result = await membershipsRbac.inviteUserRbac(req.context!, req.params.id, { email, role_code });
    if ((result as { status?: string }).status === 'invite_already_exists') {
      return res.status(200).json(result);
    }
    return res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/invites', ...withViewUsers, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const includeHistory = req.query.includeHistory === 'true';
    const list = await membershipsRbac.listInvitesRbac(req.context!, req.params.id, { includeHistory });
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/invites/:inviteId/resend', ...withInvite, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await membershipsRbac.resendInviteRbac(req.context!, req.params.id, req.params.inviteId);
    return res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/invites/:inviteId/revoke', ...withInvite, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await membershipsRbac.revokeInviteRbac(req.context!, req.params.id, req.params.inviteId);
    return res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/members/:memberId/role', ...withChangeRole, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const { role_code } = req.body ?? {};
    if (!role_code) return res.status(400).json({ code: 'BAD_REQUEST', message: 'role_code required' });
    await membershipsRbac.changeUserRoleRbac(req.context!, req.params.id, req.params.memberId, role_code);
    return res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/members/:memberId', ...withRevoke, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await membershipsRbac.revokeUserAccessRbac(req.context!, req.params.id, req.params.memberId);
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

router.post(
  '/:id/members/:memberId/commands/set_member_client_access',
  ...withSetClientAccess,
  async (req, res, next) => {
    try {
      if (req.params.id !== req.context!.organizationId) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      const aggregate = await setMemberClientAccess(
        req.context!,
        req.params.id,
        req.params.memberId,
        req.body ?? {},
      );
      // Refreshed backend truth: the command result plus the full Users & Roles aggregate.
      const users_roles_aggregate = await buildUsersRolesAggregate(req.context!, req.params.id);
      return res.json({ ...aggregate, users_roles_aggregate });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/members/:memberId/aggregates/client-access',
  ...withViewUsers,
  async (req, res, next) => {
    try {
      if (req.params.id !== req.context!.organizationId) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      return res.json(
        await buildMemberClientAccessEditorAggregate(req.context!, req.params.id, req.params.memberId),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/members/:memberId/aggregates/module-assignability',
  ...withSetModuleAccess,
  async (req, res, next) => {
    try {
      if (req.params.id !== req.context!.organizationId) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      const aggregate = await buildMemberModuleAssignabilityAggregate(
        req.context!,
        req.params.id,
        req.params.memberId,
      );
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/members/:memberId/commands/set_member_module_access',
  ...withSetModuleAccess,
  async (req, res, next) => {
    try {
      if (req.params.id !== req.context!.organizationId) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      const aggregate = await setMemberModuleAccess(
        req.context!,
        req.params.id,
        req.params.memberId,
        req.body ?? {},
      );
      const [users_roles_aggregate, module_assignability_aggregate] = await Promise.all([
        buildUsersRolesAggregate(req.context!, req.params.id),
        buildMemberModuleAssignabilityAggregate(req.context!, req.params.id, req.params.memberId),
      ]);
      return res.json({ ...aggregate, users_roles_aggregate, module_assignability_aggregate });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/:id/aggregates/users-roles', ...withViewUsers, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    return res.json(await buildUsersRolesAggregate(req.context!, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/:id/members/:memberId/commands/set_member_profile',
  ...withSetClientAccess,
  async (req, res, next) => {
    try {
      if (req.params.id !== req.context!.organizationId) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      return res.json(await setMemberProfile(req.context!, req.params.id, req.params.memberId, req.body ?? {}));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/members/:memberId/commands/close_member_access',
  ...withRevoke,
  async (req, res, next) => {
    try {
      if (req.params.id !== req.context!.organizationId) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      return res.json(await closeMemberAccess(req.context!, req.params.id, req.params.memberId));
    } catch (e) {
      next(e);
    }
  },
);

export const membershipsRoutes = router;
