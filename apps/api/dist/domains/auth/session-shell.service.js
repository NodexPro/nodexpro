/**
 * Backend-owned session shell / nav visibility (INC-3.5).
 */
import { supabaseAdmin } from '../../db/client.js';
import { isIncomeOnboardingComplete } from '../income/income-issuer-profile-sync.service.js';
import { computeSessionShellFromModules, } from './session-shell.pure.js';
export { computeSessionShellFromModules } from './session-shell.pure.js';
async function loadActiveCommercialModuleCodes(orgId) {
    const { data } = await supabaseAdmin
        .from('organization_modules')
        .select('modules(code, is_system)')
        .eq('organization_id', orgId)
        .eq('status', 'active');
    const codes = [];
    for (const row of data ?? []) {
        const raw = row.modules;
        const mod = (Array.isArray(raw) ? raw[0] : raw);
        if (!mod?.code || mod.is_system)
            continue;
        codes.push(mod.code);
    }
    return [...new Set(codes)].sort();
}
export async function resolveSessionShell(params) {
    if (!params.activeOrgId) {
        return {
            shell_profile: 'full_platform',
            default_route: '/dashboard',
            visible_nav_items: [],
            income_onboarding_complete: false,
        };
    }
    const incomeComplete = await isIncomeOnboardingComplete(params.activeOrgId);
    const commercialModules = await loadActiveCommercialModuleCodes(params.activeOrgId);
    return computeSessionShellFromModules({
        commercialModuleCodes: commercialModules,
        permissions: params.permissions,
        allCoreNavItems: params.allCoreNavItems,
        moduleAppNavItems: params.moduleAppNavItems,
        incomeOnboardingComplete: incomeComplete,
    });
}
