import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as membershipsRbac from './memberships-rbac.service.js';

const router = Router();
// Support both RBAC and legacy permission codes
const withViewUsers = [authMiddleware, requireOrg, requirePermission('view_users', 'members:read')];

// High-risk mutations: add abuse protection (per actor + route bucket).
const withInvite = [
  authMiddleware,
  requireOrg,
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
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission('change_user_role', 'members:write'),
];

const withRevoke = [
  authMiddleware,
  requireOrg,
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

export const membershipsRoutes = router;
