/**
 * Pure session shell decision (no I/O).
 */
import { isIncomeCommercialModuleCode } from '../../shared/module-entitlement.pure.js';
function canAccessSettings(permissions) {
    return permissions.includes('access_settings') || permissions.includes('settings:read');
}
function incomeModuleNavItem(moduleAppNavItems) {
    return (moduleAppNavItems.find((n) => n.path === '/m/income') ?? {
        path: '/m/income',
        label: 'הכנסות',
        order: 50,
    });
}
export function computeSessionShellFromModules(params) {
    const incomeOnly = params.commercialModuleCodes.length === 1 &&
        isIncomeCommercialModuleCode(params.commercialModuleCodes[0] ?? '');
    if (incomeOnly) {
        const incomeNav = { ...incomeModuleNavItem(params.moduleAppNavItems), order: 0 };
        const visible = [incomeNav];
        if (canAccessSettings(params.permissions)) {
            const settings = params.allCoreNavItems.find((n) => n.path === '/settings') ?? {
                path: '/settings',
                label: 'Settings',
                order: 10,
            };
            visible.push(settings);
        }
        return {
            shell_profile: 'income_only',
            default_route: params.incomeOnboardingComplete ? '/m/income' : '/settings',
            visible_nav_items: visible,
            income_onboarding_complete: params.incomeOnboardingComplete,
        };
    }
    const visible = [...params.allCoreNavItems, ...params.moduleAppNavItems].sort((a, b) => a.order - b.order);
    return {
        shell_profile: 'full_platform',
        default_route: '/dashboard',
        visible_nav_items: visible,
        income_onboarding_complete: params.incomeOnboardingComplete,
    };
}
