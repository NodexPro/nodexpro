import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { authService } from './auth.service.js';
import { supabaseAdmin } from '../../db/client.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
const router = Router();
const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey);
async function buildMeResponse(ctx, opts) {
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
        const org = supabaseEmbedOne(o.organizations);
        return { id: org?.id ?? '', name: org?.name ?? '' };
    });
    const orgIdSet = new Set(orgList.map((o) => o.id).filter(Boolean));
    let activeOrgId = opts?.preferredActiveOrganizationId ?? ctx.organizationId ?? null;
    if (activeOrgId && !orgIdSet.has(activeOrgId))
        activeOrgId = null;
    if (!activeOrgId && orgList.length === 1)
        activeOrgId = orgList[0].id;
    let permissions = ctx.membership?.permissions ?? [];
    if (activeOrgId && permissions.length === 0) {
        const { loadMembershipWithPermissions } = await import('../rbac/rbac.service.js');
        const m = await loadMembershipWithPermissions(ctx.user.id, activeOrgId);
        if (m)
            permissions = m.permissions;
        else {
            const { data: ou } = await supabaseAdmin
                .from('organization_users')
                .select('roles(code, role_permissions(permissions(code)))')
                .eq('organization_id', activeOrgId)
                .eq('user_id', ctx.user.id)
                .eq('membership_status', 'active')
                .single();
            const role = supabaseEmbedOne(ou?.roles);
            permissions = (role?.role_permissions ?? []).map((rp) => rp.permissions?.code).filter((c) => !!c);
        }
    }
    let enabledModules = [];
    const navItems = [];
    navItems.push({ path: '/dashboard', label: 'Dashboard', order: 0 });
    const { hasPermission } = await import('../rbac/rbac.service.js');
    if (hasPermission(permissions, 'access_settings') || permissions.includes('settings:read'))
        navItems.push({ path: '/settings', label: 'Settings', order: 10 });
    if (hasPermission(permissions, 'view_users') || permissions.includes('members:read'))
        navItems.push({ path: '/users-roles', label: 'Users & Roles', order: 20 });
    if (hasPermission(permissions, 'view_clients') || permissions.includes('clients:read'))
        navItems.push({ path: '/clients', label: 'Clients', order: 25 });
    if (hasPermission(permissions, 'view_documents') || permissions.includes('documents:read'))
        navItems.push({ path: '/documents', label: 'Documents', order: 26 });
    if (hasPermission(permissions, 'access_billing') || permissions.includes('subscriptions:read') || permissions.includes('modules:read'))
        navItems.push({ path: '/modules', label: 'Modules', order: 30 });
    if (hasPermission(permissions, 'access_billing') || permissions.includes('subscriptions:read'))
        navItems.push({ path: '/billing', label: 'Billing', order: 40 });
    const moduleAppNavItems = [];
    if (activeOrgId) {
        const mods = await supabaseAdmin.from('organization_modules').select('modules(code, nav_path, nav_label, nav_order)').eq('organization_id', activeOrgId).eq('status', 'active');
        const modList = (mods.data ?? []);
        const rowMod = (raw) => (Array.isArray(raw) ? raw[0] : raw);
        enabledModules = modList.map((m) => rowMod(m.modules)?.code).filter((c) => !!c);
        for (const m of modList) {
            const mo = rowMod(m.modules);
            if (!mo?.nav_path?.startsWith('/m/'))
                continue;
            const label = mo.code === 'client-operations' ? 'Nodex לקוחות' : (mo.nav_label ?? mo.code);
            moduleAppNavItems.push({ path: mo.nav_path, label, order: mo.nav_order ?? 100 });
        }
    }
    moduleAppNavItems.sort((a, b) => a.order - b.order);
    navItems.sort((a, b) => a.order - b.order);
    return {
        user: { id: ctx.user.id, email: ctx.user.email, fullName: ctx.user.fullName, status: ctx.user.status },
        organizations: orgList,
        activeOrganizationId: activeOrgId,
        permissions,
        enabledModules,
        navItems,
        moduleAppNavItems: moduleAppNavItems.map(({ path, label }) => ({ path, label })),
    };
}
function toAuthSessionAggregate(me) {
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
        if (!email || !password)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'email and password required' });
        const result = await authService.register({ email, password, fullName });
        return res.status(201).json(result);
    }
    catch (e) {
        next(e);
    }
});
router.post('/login', rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
        return email || req.ip || 'unknown';
    },
    message: 'Too many login attempts. Please wait and try again later.',
}), async (req, res, next) => {
    try {
        const { email, password } = req.body ?? {};
        if (!email || !password)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'email and password required' });
        const result = await authService.login({ email, password });
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.post('/logout', authMiddleware, async (req, res, next) => {
    try {
        const token = req.headers.authorization?.slice(7);
        if (token)
            await supabaseAuth.auth.admin.signOut(token).catch(() => { });
        return res.status(204).send();
    }
    catch (e) {
        next(e);
    }
});
router.get('/me', authMiddleware, async (req, res, next) => {
    try {
        const ctx = req.context;
        const body = await buildMeResponse(ctx);
        return res.json(body);
    }
    catch (e) {
        next(e);
    }
});
router.get('/session', authMiddleware, async (req, res, next) => {
    try {
        const ctx = req.context;
        const me = await buildMeResponse(ctx);
        return res.json(toAuthSessionAggregate(me));
    }
    catch (e) {
        next(e);
    }
});
router.post('/invite/accept', authMiddleware, async (req, res, next) => {
    try {
        const { token } = req.body ?? {};
        if (!token)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'token required' });
        const { acceptInviteRbac } = await import('../memberships/memberships-rbac.service.js');
        const result = await acceptInviteRbac(req.context, token);
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.put('/me/active-organization', authMiddleware, async (req, res, next) => {
    try {
        const { organizationId } = req.body ?? {};
        if (!organizationId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId required' });
        let data = (await supabaseAdmin.from('organization_memberships').select('organization_id').eq('user_id', req.context.user.id).eq('organization_id', organizationId).eq('status', 'active').single()).data;
        if (!data)
            data = (await supabaseAdmin.from('organization_users').select('organization_id').eq('user_id', req.context.user.id).eq('organization_id', organizationId).eq('membership_status', 'active').single()).data;
        if (!data)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
        return res.json({ activeOrganizationId: organizationId });
    }
    catch (e) {
        next(e);
    }
});
router.post('/commands/select_active_organization', authMiddleware, async (req, res, next) => {
    try {
        const organizationId = String(req.body?.organization_id ?? '').trim();
        if (!organizationId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'organization_id required' });
        let data = (await supabaseAdmin
            .from('organization_memberships')
            .select('organization_id')
            .eq('user_id', req.context.user.id)
            .eq('organization_id', organizationId)
            .eq('status', 'active')
            .single()).data;
        if (!data) {
            data = (await supabaseAdmin
                .from('organization_users')
                .select('organization_id')
                .eq('user_id', req.context.user.id)
                .eq('organization_id', organizationId)
                .eq('membership_status', 'active')
                .single()).data;
        }
        if (!data)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
        const me = await buildMeResponse(req.context, { preferredActiveOrganizationId: organizationId });
        return res.json(toAuthSessionAggregate(me));
    }
    catch (e) {
        next(e);
    }
});
export const authRoutes = router;
