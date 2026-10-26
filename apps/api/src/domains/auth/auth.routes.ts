import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { authService } from './auth.service.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import {
  getUserStoredActiveOrganizationId,
  listUserActiveOrganizationIds,
  loadOrgMembershipForUser,
  updateUserStoredActiveOrganizationId,
} from './active-organization.service.js';
import { mayUseLegacyOrganizationUsersAccessFallback } from '../memberships/organization-membership-access.js';
import type {
  AuthSessionAggregateResponse,
  MeResponse,
  SidebarAccountBlockModel,
  UiLanguageCode,
} from '../../types/api.js';
import { supabaseAdmin } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { getRequestCorrelationId } from '../../middleware/correlation.js';
import { deviceCookieHeader } from './mfa-trusted-device.pure.js';
import {
  acknowledgeMfaPrompt,
  buildMfaOnboardingAggregate,
  cancelMfaEnrollment,
  enrollMfaFactor,
  issueMfaRecoveryCodes,
  recoverMfaFactor,
  refreshAuthSession,
  verifyMfaRecovery,
  removeMfaFactor,
  replaceMfaFactor,
  revokeTrustedDevice,
  trustMfaDevice,
  verifyMfaFactor,
} from './privileged-mfa.service.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import type { RequestContext } from '../../shared/context.js';
import { resolveSessionShell } from './session-shell.service.js';
import { loadSessionPreferenceSlices } from './session-preferences.service.js';
import { isIncomeOnboardingComplete } from '../income/income-issuer-profile-sync.service.js';
import { filterSessionEnabledModuleCodes } from '../modules/entitlement.service.js';
import { loadEnabledMemberModuleIdSet } from '../modules/member-module-access.service.js';
import { roleHasOfficeClientAccess } from '../client-operations/organization-client-access.pure.js';
import { buildSidebarAccountBlock } from './sidebar-account-block.pure.js';

const router = Router();
const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey);

function resolveUiLanguage(ctx: RequestContext): UiLanguageCode {
  const stored = ctx.user.uiLanguage;
  if (stored && /^[a-z]{2}(-[A-Z]{2})?$/.test(stored)) return stored;
  return 'en';
}

type MeCoreForSidebar = Omit<MeResponse, 'sidebar_account_block'>;

async function buildMeResponse(
  ctx: RequestContext,
  opts?: { preferredActiveOrganizationId?: string | null }
): Promise<MeResponse> {
  const [activeOrgIds, preferenceSlices] = await Promise.all([
    listUserActiveOrganizationIds(ctx.user.id),
    loadSessionPreferenceSlices(ctx),
  ]);
  const orgIdSet = new Set(activeOrgIds.filter(Boolean));
  let activeOrgId = opts?.preferredActiveOrganizationId ?? ctx.organizationId ?? null;
  if (activeOrgId && !orgIdSet.has(activeOrgId)) activeOrgId = null;
  let permissions = ctx.membership?.permissions ?? [];

  type SessionModuleNav = {
    code: string;
    nav_path: string | null;
    nav_label: string | null;
    nav_order: number | null;
    is_system?: boolean | null;
    is_active?: boolean | null;
  };
  const rowMod = (raw: unknown) =>
    (Array.isArray(raw) ? raw[0] : raw) as SessionModuleNav | undefined;

  const [orgRowsRes, modsRes, incomeComplete, refreshedMembership] = await Promise.all([
    activeOrgIds.length
      ? supabaseAdmin.from('organizations').select('id, name, country_code').in('id', activeOrgIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; country_code?: string | null }> }),
    activeOrgId
      ? supabaseAdmin
          .from('organization_modules')
          .select('module_id, modules(code, nav_path, nav_label, nav_order, is_system, is_active)')
          .eq('organization_id', activeOrgId)
          .eq('status', 'active')
      : Promise.resolve({ data: [] as Array<{ module_id: string; modules: unknown }> }),
    activeOrgId ? isIncomeOnboardingComplete(activeOrgId) : Promise.resolve(false),
    activeOrgId && permissions.length === 0
      ? (async () => {
          const { loadMembershipWithPermissions } = await import('../rbac/rbac.service.js');
          return loadMembershipWithPermissions(ctx.user.id, activeOrgId);
        })()
      : Promise.resolve(null),
  ]);

  const orgList: Array<{ id: string; name: string }> = [];
  const orgCountryById = new Map<string, string | null>();
  const typedOrgRows = (orgRowsRes.data ?? []) as Array<{ id: string; name: string; country_code?: string | null }>;
  const byId = new Map(typedOrgRows.map((o) => [o.id, o.name]));
  for (const o of typedOrgRows) orgCountryById.set(o.id, o.country_code ?? null);
  for (const id of activeOrgIds) {
    orgList.push({ id, name: byId.get(id) ?? '' });
  }

  if (refreshedMembership) {
    permissions = refreshedMembership.permissions;
  } else if (activeOrgId && permissions.length === 0 && (await mayUseLegacyOrganizationUsersAccessFallback(ctx.user.id, activeOrgId))) {
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
  let commercialModuleCodes: string[] = [];
  if (activeOrgId) {
    const modList = (modsRes.data ?? []) as { module_id: string; modules: unknown }[];
    const sessionModules = modList
      .map((m) => {
        const mo = rowMod(m.modules);
        if (!mo?.code) return null;
        return { moduleId: m.module_id, code: mo.code, nav: mo };
      })
      .filter((m): m is { moduleId: string; code: string; nav: SessionModuleNav } => m != null);
    commercialModuleCodes = [...new Set(
      sessionModules
        .filter((m) => m.nav.is_system !== true && m.nav.is_active !== false)
        .map((m) => m.code),
    )].sort();
    const roleCode = ctx.membership?.roleCode ?? refreshedMembership?.roleCode ?? '';
    const [entitledCodes, memberModuleIds] = await Promise.all([
      filterSessionEnabledModuleCodes({
        organizationId: activeOrgId,
        modules: sessionModules.map((m) => ({ moduleId: m.moduleId, code: m.code })),
      }),
      roleHasOfficeClientAccess(roleCode) ? Promise.resolve(null) : loadEnabledMemberModuleIdSet(activeOrgId, ctx.user.id),
    ]);
    enabledModules = sessionModules
      .map((m) => m.code)
      .filter((code) => entitledCodes.has(code));
    if (memberModuleIds) {
      const grantedCodes = new Set(
        sessionModules.filter((m) => memberModuleIds.has(m.moduleId)).map((m) => m.code),
      );
      enabledModules = enabledModules.filter((code) => grantedCodes.has(code));
    }
    for (const m of sessionModules) {
      if (!entitledCodes.has(m.code)) continue;
      if (memberModuleIds && !memberModuleIds.has(m.moduleId)) continue;
      const mo = m.nav;
      if (!mo.nav_path?.startsWith('/m/')) continue;
      const label = mo.code === 'client-operations' ? 'Nodex לקוחות' : (mo.nav_label ?? mo.code);
      moduleAppNavItems.push({ path: mo.nav_path, label, order: mo.nav_order ?? 100 });
    }
  }
  moduleAppNavItems.sort((a, b) => a.order - b.order);
  navItems.sort((a, b) => a.order - b.order);

  const uiLanguage = resolveUiLanguage(ctx);
  const shell = await resolveSessionShell({
    activeOrgId,
    roleCode: ctx.membership?.roleCode ?? refreshedMembership?.roleCode ?? null,
    membershipActive: Boolean(ctx.membership?.roleCode || refreshedMembership?.roleCode),
    permissions,
    allCoreNavItems: navItems,
    moduleAppNavItems,
    preloadedIncomeOnboardingComplete: incomeComplete,
    preloadedCommercialModuleCodes: commercialModuleCodes,
  });
  const exposedCoreNav = shell.available_navigation.filter((item) => !item.path.startsWith('/m/'));
  const meCore: MeCoreForSidebar = {
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      fullName: ctx.user.fullName,
      status: ctx.user.status,
      email_verified: Boolean(ctx.user.emailVerified),
    },
    account_security: preferenceSlices.account_security,
    localization: preferenceSlices.localization,
    organizations: orgList,
    activeOrganizationId: activeOrgId,
    permissions,
    enabledModules,
    navItems: exposedCoreNav,
    moduleAppNavItems: shell.available_modules.map(({ path, label }) => ({ path, label })),
    shell_profile: shell.shell_profile,
    default_route: shell.default_route,
    visible_nav_items: shell.available_navigation,
    available_navigation: shell.available_navigation,
    available_modules: shell.available_modules,
    available_actions: shell.available_actions,
    income_onboarding_complete: shell.income_onboarding_complete,
  };
  return {
    ...meCore,
    sidebar_account_block: buildSidebarAccountBlock({
      user: { email: meCore.user.email, fullName: meCore.user.fullName },
      organizations: meCore.organizations,
      activeOrganizationId: meCore.activeOrganizationId,
      shellProfile: meCore.shell_profile,
      uiLanguage,
      activeOrganizationCountryCode: meCore.activeOrganizationId
        ? (orgCountryById.get(meCore.activeOrganizationId) ?? null)
        : null,
    }),
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
  return {
    ...me,
    session_state: 'ready',
    redirect_to: me.default_route || '/dashboard',
    allowed_actions: [],
  };
}

router.post(
  '/register',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
      return `${req.ip ?? 'unknown'}:${email || 'no-email'}`;
    },
    message: 'Too many registration attempts. Please wait and try again later.',
  }),
  async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ code: 'BAD_REQUEST', message: 'email and password required' });
    const result = await authService.register({ email, password, fullName });
    return res.status(201).json(result);
  } catch (e) {
    next(e);
  }
  }
);

router.post(
  '/login',
  async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ code: 'BAD_REQUEST', message: 'email and password required' });
    const result = await authService.login({ email, password });
    return res.json({ session: result.session, user: result.user });
  } catch (e) {
    const { recordFailedLoginAttempt } = await import('../../shared/failed-login.service.js');
    const identifier = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const outcome = await recordFailedLoginAttempt({
      sourceIp: req.trustedClientIp ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      attemptedEmail: identifier || null,
      correlationId: getRequestCorrelationId(req),
      loginSucceeded: false,
      isPlatformOwnerEmergency: false,
    }).catch(() => ({ stage: 'journal' as const, count: 1, retryAfterSeconds: 0, cooldown: false }));
    if (outcome.cooldown) {
      res.setHeader('Retry-After', String(outcome.retryAfterSeconds || 180));
      return res.status(429).json({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many login attempts. Please wait and try again later.',
        retry_after: outcome.retryAfterSeconds || 180,
      });
    }
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
    const membership = await loadOrgMembershipForUser(req.context!.user.id, organizationId);
    if (!membership) return res.status(403).json({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
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
    const freshCtx: RequestContext = { ...req.context!, organizationId, membership };
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
    const membership = await loadOrgMembershipForUser(req.context!.user.id, organizationId);
    if (!membership) return res.status(403).json({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
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
    const freshCtx: RequestContext = { ...req.context!, organizationId, membership };
    const me = await buildMeResponse(freshCtx, { preferredActiveOrganizationId: organizationId });
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

router.post('/commands/set_ui_language', authMiddleware, async (req, res, next) => {
  try {
    const languageCode = String(req.body?.language_code ?? '').trim();
    const { buildPublishedLocalizationOptions } = await import('../platform-localization/platform-localization.service.js');
    let allowedLocales = ['en', 'he'];
    try {
      const published = await buildPublishedLocalizationOptions();
      const publishedLocales = published.languages.map((row) => row.locale);
      if (publishedLocales.length) allowedLocales = publishedLocales;
    } catch {
      allowedLocales = ['en', 'he'];
    }
    if (!allowedLocales.includes(languageCode)) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'language_code must be a published language' });
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

router.post('/commands/set_localization_preferences', authMiddleware, async (req, res, next) => {
  try {
    const { setUserLocalizationPreferences } = await import('../platform-localization/platform-localization.service.js');
    const ctx = req.context!;
    const updated = await setUserLocalizationPreferences(ctx, {
      language_code: req.body?.language_code,
      timezone: req.body?.timezone,
      date_format: req.body?.date_format,
      display_currency_code: req.body?.display_currency_code,
    });
    const freshCtx: RequestContext = {
      ...ctx,
      user: { ...ctx.user, uiLanguage: updated.languageCode },
    };
    const me = await buildMeResponse(freshCtx);
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/commands/request_additional_login_email',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? req.ip ?? 'unknown' }),
  async (req, res, next) => {
    try {
      const { requestAdditionalLoginEmail } = await import('../account-security/account-security.service.js');
      await requestAdditionalLoginEmail(req.context!, String(req.body?.email ?? ''), req);
      const me = await buildMeResponse(req.context!);
      return res.json(toAuthSessionAggregate(me));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/replace_additional_login_email',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? req.ip ?? 'unknown' }),
  async (req, res, next) => {
    try {
      const { replaceAdditionalLoginEmail } = await import('../account-security/account-security.service.js');
      await replaceAdditionalLoginEmail(req.context!, String(req.body?.email ?? ''), req);
      const me = await buildMeResponse(req.context!);
      return res.json(toAuthSessionAggregate(me));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/resend_additional_login_email',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? req.ip ?? 'unknown' }),
  async (req, res, next) => {
    try {
      const { resendAdditionalLoginEmail } = await import('../account-security/account-security.service.js');
      await resendAdditionalLoginEmail(req.context!, req);
      const me = await buildMeResponse(req.context!);
      return res.json(toAuthSessionAggregate(me));
    } catch (e) {
      next(e);
    }
  },
);

router.post('/commands/remove_additional_login_email', authMiddleware, async (req, res, next) => {
  try {
    const { removeAdditionalLoginEmail } = await import('../account-security/account-security.service.js');
    await removeAdditionalLoginEmail(req.context!, req);
    const me = await buildMeResponse(req.context!);
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/commands/verify_additional_login_email',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyGenerator: (req) => req.ip ?? 'unknown' }),
  async (req, res, next) => {
    try {
      const { verifyAdditionalLoginEmail } = await import('../account-security/account-security.service.js');
      const result = await verifyAdditionalLoginEmail(String(req.body?.token ?? ''), req);
      return res.json({ ok: true, verified: true, user_id: result.user_id });
    } catch (e) {
      next(e);
    }
  },
);

router.post('/commands/change_password', authMiddleware, async (req, res, next) => {
  try {
    const { changePasswordThroughSupabase } = await import('../account-security/account-security.service.js');
    await changePasswordThroughSupabase(
      req.context!,
      {
        currentPassword: String(req.body?.current_password ?? ''),
        newPassword: String(req.body?.new_password ?? ''),
        confirmPassword: String(req.body?.confirm_password ?? ''),
      },
      req,
    );
    const me = await buildMeResponse(req.context!);
    return res.json(toAuthSessionAggregate(me));
  } catch (e) {
    next(e);
  }
});

router.get('/aggregates/mfa', authMiddleware, async (req, res, next) => {
  try {
    const token = req.headers.authorization?.slice(7) ?? '';
    return res.json(await buildMfaOnboardingAggregate(req.context!, token));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/commands/acknowledge_mfa_prompt',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await acknowledgeMfaPrompt(req.context!, token, req.body?.decision, req.body?.warning_version));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/enroll_mfa',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.status(201).json(await enrollMfaFactor(req.context!, token, req.body?.recovery_enrollment_grant));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/verify_mfa',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await verifyMfaFactor(
        req.context!,
        token,
        String(req.body?.factor_id ?? ''),
        String(req.body?.code ?? ''),
        req.body?.recovery_enrollment_grant,
      ));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/cancel_mfa_enrollment',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await cancelMfaEnrollment(req.context!, token));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/remove_mfa_factor',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await removeMfaFactor(req.context!, token, req.body?.factor_id));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/replace_mfa_factor',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.status(201).json(await replaceMfaFactor(req.context!, token));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/issue_mfa_recovery_codes',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 3, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.status(201).json(await issueMfaRecoveryCodes(req.context!, token));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/recover_mfa',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await recoverMfaFactor(req.context!, token, req.body?.recovery_code));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/verify_mfa_recovery',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await verifyMfaRecovery(req.context!, token, req.body?.recovery_code));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/trust_mfa_device',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      const issued = await trustMfaDevice(req.context!, token);
      res.setHeader('Set-Cookie', deviceCookieHeader(issued.credential, config.nodeEnv === 'production'));
      const { credential: _credential, ...body } = issued;
      return res.status(201).json(body);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/revoke_trusted_device',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await revokeTrustedDevice(req.context!, token, req.body?.device_id));
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/refresh_session',
  authMiddleware,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyGenerator: (req) => req.context?.user.id ?? 'anon' }),
  async (req, res, next) => {
    try {
      return res.json(await refreshAuthSession(req.context!, String(req.body?.refresh_token ?? '')));
    } catch (e) {
      next(e);
    }
  },
);

export const authRoutes = router;
