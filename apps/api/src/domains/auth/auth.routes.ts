import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { authService } from './auth.service.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import {
  getUserStoredActiveOrganizationId,
  loadOrgMembershipForUser,
  updateUserStoredActiveOrganizationId,
} from './active-organization.service.js';
import type {
  AuthSessionAggregateResponse,
  MeResponse,
  SidebarAccountBlockModel,
  UiLanguageCode,
} from '../../types/api.js';
import { supabaseAdmin } from '../../db/client.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import type { RequestContext } from '../../shared/context.js';

const router = Router();
const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey);

function resolveUiLanguage(ctx: RequestContext): UiLanguageCode {
  const stored = ctx.user.uiLanguage;
  if (stored === 'he' || stored === 'en') return stored;
  return 'en';
}

type MeCoreForSidebar = Omit<MeResponse, 'sidebar_account_block'>;

function buildSidebarAccountBlock(me: MeCoreForSidebar, uiLanguage: UiLanguageCode): SidebarAccountBlockModel {
  const activeOrg = me.organizations.find((o) => o.id === me.activeOrganizationId) ?? null;
  const organizationName =
    activeOrg?.name ?? (me.organizations.length === 1 ? me.organizations[0]?.name ?? null : null);
  const displayName = (me.user.fullName?.trim() || me.user.email || '').trim();
  const labels =
    uiLanguage === 'he'
      ? { org: 'ארגון', language: 'שפה', logout: 'התנתקות', en: 'English', he: 'עברית' }
      : { org: 'Organization', language: 'Language', logout: 'Sign out', en: 'English', he: 'עברית' };

  return {
    organization_name: organizationName,
    user_display_name: displayName,
    user_email: me.user.email,
    organization_switcher: {
      visible: me.organizations.length > 1,
      label: labels.org,
      organizations: me.organizations.map((o) => ({
        organization_id: o.id,
        name: o.name,
        selected: o.id === me.activeOrganizationId,
      })),
    },
    language_selector: {
      label: labels.language,
      current_value: uiLanguage,
      options: [
        { value: 'en', label: labels.en },
        { value: 'he', label: labels.he },
      ],
    },
    logout_action: {
      label: labels.logout,
      command_key: 'logout',
    },
  };
}

async function buildMeResponse(
  ctx: RequestContext,
  opts?: { preferredActiveOrganizationId?: string | null }
): Promise<MeResponse> {
  let orgs = await supabaseAdmin
    .from('organization_memberships')
    .select('organization_id, organizations(id, name)')
    .eq('user_id', ctx.user.id)
    .eq('status', 'active');
  if (!orgs.data?.length) {
    orgs = await supabaseAdmin
      .from('organization_users')
      .select('organization_id, organizations(id, name)')
      .eq('user_id', ctx.user.id)
      .eq('membership_status', 'active');
  }
  const orgList = (orgs.data ?? []).map((o) => {
    const org = supabaseEmbedOne(
      (o as { organizations: { id: string; name: string } | { id: string; name: string }[] | null }).organizations
    );
    return { id: org?.id ?? '', name: org?.name ?? '' };
  });
  const orgIdSet = new Set(orgList.map((o) => o.id).filter(Boolean));
  let activeOrgId = opts?.preferredActiveOrganizationId ?? ctx.organizationId ?? null;
  if (activeOrgId && !orgIdSet.has(activeOrgId)) activeOrgId = null;
  let permissions = ctx.membership?.permissions ?? [];
  if (activeOrgId && permissions.length === 0) {
    const { loadMembershipWithPermissions } = await import('../rbac/rbac.service.js');
    const m = await loadMembershipWithPermissions(ctx.user.id, activeOrgId);
    if (m) permissions = m.permissions;
    else {
      const { data: ou } = await supabaseAdmin
        .from('organization_users')
        .select('roles(code, role_permissions(permissions(code)))')
        .eq('organization_id', activeOrgId)
        .eq('user_id', ctx.user.id)
        .eq('membership_status', 'active')
        .single();
      const role = supabaseEmbedOne(
        ou?.roles as { role_permissions?: Array<{ permissions: { code: string } | null }> } | null | undefined
      );
      permissions = (role?.role_permissions ?? []).map((rp) => rp.permissions?.code).filter((c): c is string => !!c);
    }
  }
  let enabledModules: string[] = [];
  const navItems: { path: string; label: string; order: number }[] = [];

  navItems.push({ path: '/dashboard', label: 'Dashboard', order: 0 });
  const { hasPermission } = await import('../rbac/rbac.service.js');
  if (hasPermission(permissions, 'access_settings') || permissions.includes('settings:read')) navItems.push({ path: '/settings', label: 'Settings', order: 10 });
  if (hasPermission(permissions, 'view_users') || permissions.includes('members:read')) navItems.push({ path: '/users-roles', label: 'Users & Roles', order: 20 });
  if (hasPermission(permissions, 'view_clients') || permissions.includes('clients:read')) navItems.push({ path: '/clients', label: 'Clients', order: 25 });
  if (hasPermission(permissions, 'view_documents') || permissions.includes('documents:read')) navItems.push({ path: '/documents', label: 'Documents', order: 26 });
  if (hasPermission(permissions, 'access_billing') || permissions.includes('subscriptions:read') || permissions.includes('modules:read')) navItems.push({ path: '/modules', label: 'Modules', order: 30 });
  if (hasPermission(permissions, 'access_billing') || permissions.includes('subscriptions:read')) navItems.push({ path: '/billing', label: 'Billing', order: 40 });

  const moduleAppNavItems: { path: string; label: string; order: number }[] = [];
  if (activeOrgId) {
    const mods = await supabaseAdmin.from('organization_modules').select('modules(code, nav_path, nav_label, nav_order)').eq('organization_id', activeOrgId).eq('status', 'active');
    const modList = (mods.data ?? []) as { modules: unknown }[];
    const rowMod = (raw: unknown) =>
      (Array.isArray(raw) ? raw[0] : raw) as
        | { code: string; nav_path: string | null; nav_label: string | null; nav_order: number | null }
        | undefined;
    enabledModules = modList.map((m) => rowMod(m.modules)?.code).filter((c): c is string => !!c);
    for (const m of modList) {
      const mo = rowMod(m.modules);
      if (!mo?.nav_path?.startsWith('/m/')) continue;
      const label = mo.code === 'client-operations' ? 'Nodex לקוחות' : (mo.nav_label ?? mo.code);
      moduleAppNavItems.push({ path: mo.nav_path, label, order: mo.nav_order ?? 100 });
    }
  }
  moduleAppNavItems.sort((a, b) => a.order - b.order);
  navItems.sort((a, b) => a.order - b.order);

  const uiLanguage = resolveUiLanguage(ctx);
  const meCore: MeCoreForSidebar = {
    user: { id: ctx.user.id, email: ctx.user.email, fullName: ctx.user.fullName, status: ctx.user.status },
    organizations: orgList,
    activeOrganizationId: activeOrgId,
    permissions,
    enabledModules,
    navItems,
    moduleAppNavItems: moduleAppNavItems.map(({ path, label }) => ({ path, label })),
  };
  return {
    ...meCore,
    sidebar_account_block: buildSidebarAccountBlock(meCore, uiLanguage),
  };
}

function toAuthSessionAggregate(me: MeResponse): AuthSessionAggregateResponse {
  const ownerEmail = (config.platformOwner.email ?? '').trim().toLowerCase();
  const userEmail = (me.user.email ?? '').trim().toLowerCase();
  const isPlatformOwner = Boolean(ownerEmail) && userEmail === ownerEmail && me.organizations.length === 0;
  const isBlocked = (me.user.status ?? '').trim().toLowerCase() !== 'active';

  if (isBlocked) {
    return { ...me, session_state: 'blocked', redirect_to: '/login', allowed_actions: [] };
  }
  if (isPlatformOwner) {
    return { ...me, session_state: 'platform_owner', redirect_to: '/platform-owner/legal-control', allowed_actions: [] };
  }
  if (me.organizations.length === 0) {
    return { ...me, session_state: 'needs_onboarding', redirect_to: '/onboarding', allowed_actions: ['create_organization'] };
  }
  if (!me.activeOrganizationId) {
    return { ...me, session_state: 'needs_org_selection', redirect_to: '/select-org', allowed_actions: ['select_organization'] };
  }
  return { ...me, session_state: 'ready', redirect_to: '/dashboard', allowed_actions: [] };
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ code: 'BAD_REQUEST', message: 'email and password required' });
    const result = await authService.register({ email, password, fullName });
    return res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/login',
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
      return email || req.ip || 'unknown';
    },
    message: 'Too many login attempts. Please wait and try again later.',
  }),
  async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ code: 'BAD_REQUEST', message: 'email and password required' });
    const result = await authService.login({ email, password });
    return res.json(result);
  } catch (e) {
    next(e);
  }
  }
);

router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    const token = req.headers.authorization?.slice(7);
    if (token) await supabaseAuth.auth.admin.signOut(token).catch(() => {});
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const ctx = req.context!;
    const body = await buildMeResponse(ctx);
    return res.json(body);
  } catch (e) {
    next(e);
  }
});

router.get('/session', authMiddleware, async (req, res, next) => {
  try {
    const ctx = req.context!;
    const me = await buildMeResponse(ctx);
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

router.post('/invite/accept', authMiddleware, async (req, res, next) => {
  try {
    const { token } = req.body ?? {};
    if (!token) return res.status(400).json({ code: 'BAD_REQUEST', message: 'token required' });
    const { acceptInviteRbac } = await import('../memberships/memberships-rbac.service.js');
    const result = await acceptInviteRbac(req.context!, token);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

router.put('/me/active-organization', authMiddleware, async (req, res, next) => {
  try {
    const { organizationId } = req.body ?? {};
    if (!organizationId) return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId required' });
    let data = (await supabaseAdmin.from('organization_memberships').select('organization_id').eq('user_id', req.context!.user.id).eq('organization_id', organizationId).eq('status', 'active').single()).data;
    if (!data) data = (await supabaseAdmin.from('organization_users').select('organization_id').eq('user_id', req.context!.user.id).eq('organization_id', organizationId).eq('membership_status', 'active').single()).data;
    if (!data) return res.status(403).json({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
    const userId = req.context!.user.id;
    const previousOrgId = await getUserStoredActiveOrganizationId(userId);
    await updateUserStoredActiveOrganizationId(userId, organizationId);
    await writeAudit({
      organizationId,
      actorUserId: userId,
      entityType: 'user',
      entityId: userId,
      action: AUDIT_ACTIONS.AUTH_ACTIVE_ORG_SELECTED,
      payload: { previous_org_id: previousOrgId, new_org_id: organizationId, actor_user_id: userId },
      ipAddress: typeof req.ip === 'string' && req.ip ? req.ip : null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    const freshMembership = await loadOrgMembershipForUser(userId, organizationId);
    const freshCtx: RequestContext = { ...req.context!, organizationId, membership: freshMembership };
    const me = await buildMeResponse(freshCtx, { preferredActiveOrganizationId: organizationId });
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

router.post('/commands/select_active_organization', authMiddleware, async (req, res, next) => {
  try {
    const organizationId = String(req.body?.organization_id ?? '').trim();
    if (!organizationId) return res.status(400).json({ code: 'BAD_REQUEST', message: 'organization_id required' });
    let data = (
      await supabaseAdmin
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', req.context!.user.id)
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .single()
    ).data;
    if (!data) {
      data = (
        await supabaseAdmin
          .from('organization_users')
          .select('organization_id')
          .eq('user_id', req.context!.user.id)
          .eq('organization_id', organizationId)
          .eq('membership_status', 'active')
          .single()
      ).data;
    }
    if (!data) return res.status(403).json({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
    const userId = req.context!.user.id;
    const previousOrgId = await getUserStoredActiveOrganizationId(userId);
    await updateUserStoredActiveOrganizationId(userId, organizationId);
    await writeAudit({
      organizationId,
      actorUserId: userId,
      entityType: 'user',
      entityId: userId,
      action: AUDIT_ACTIONS.AUTH_ACTIVE_ORG_SELECTED,
      payload: { previous_org_id: previousOrgId, new_org_id: organizationId, actor_user_id: userId },
      ipAddress: typeof req.ip === 'string' && req.ip ? req.ip : null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    const freshMembership = await loadOrgMembershipForUser(userId, organizationId);
    const freshCtx: RequestContext = { ...req.context!, organizationId, membership: freshMembership };
    const me = await buildMeResponse(freshCtx, { preferredActiveOrganizationId: organizationId });
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

router.post('/commands/set_ui_language', authMiddleware, async (req, res, next) => {
  try {
    const languageCode = String(req.body?.language_code ?? '').trim();
    if (languageCode !== 'en' && languageCode !== 'he') {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'language_code must be en or he' });
    }
    const ctx = req.context!;
    const previous = ctx.user.uiLanguage;
    await supabaseAdmin
      .from('users')
      .update({ ui_language: languageCode, updated_at: new Date().toISOString() })
      .eq('id', ctx.user.id);
    await writeAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      entityType: 'user',
      entityId: ctx.user.id,
      action: AUDIT_ACTIONS.AUTH_UI_LANGUAGE_SET,
      payload: { previous_language: previous, new_language: languageCode },
      ipAddress: typeof req.ip === 'string' && req.ip ? req.ip : null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    const freshCtx: RequestContext = {
      ...ctx,
      user: { ...ctx.user, uiLanguage: languageCode },
    };
    const me = await buildMeResponse(freshCtx);
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

export const authRoutes = router;
