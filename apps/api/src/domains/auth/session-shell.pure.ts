/**
 * Pure session shell decision (no I/O).
 */

import { isIncomeCommercialModuleCode } from '../../shared/module-entitlement.pure.js';

export type ShellProfile = 'income_only' | 'full_platform' | 'worker' | 'closed';

function canAccessSettings(permissions: string[]): boolean {
  return permissions.includes('access_settings') || permissions.includes('settings:read');
}

export interface NavItemDto {
  path: string;
  label: string;
  order: number;
}

export interface SessionShellModel {
  shell_profile: ShellProfile;
  default_route: string;
  visible_nav_items: NavItemDto[];
  income_onboarding_complete: boolean;
  /** UI-ready navigation. Stage 5.4 can filter module entries without a second matrix. */
  available_navigation: NavItemDto[];
  available_modules: NavItemDto[];
  /** Office-administration actions. Workers receive none. */
  available_actions: string[];
}

const WORKER_MODULES_NAV: NavItemDto = { path: '/modules', label: 'Modules', order: 30 };

const OFFICE_ADMIN_ROLES = new Set(['owner', 'admin']);
const WORKER_ROLES = new Set(['staff', 'viewer']);

export function officeAdminActionsForPermissions(permissions: string[]): string[] {
  const actions: string[] = [];
  if (permissions.includes('clients:write')) {
    actions.push(
      'create_client',
      'import_clients',
      'preview_client_import',
      'mark_client_inactive',
      'reactivate_client',
    );
  }
  if (permissions.includes('clients:archive')) {
    actions.push('archive_client', 'restore_client');
  }
  if (permissions.includes('settings:read') || permissions.includes('access_settings')) {
    actions.push('organization_settings');
  }
  if (permissions.includes('members:read') || permissions.includes('view_users')) {
    actions.push('member_management');
  }
  if (permissions.includes('subscriptions:read') || permissions.includes('access_billing')) {
    actions.push('billing');
  }
  if (permissions.includes('modules:write')) {
    actions.push('module_administration');
  }
  return actions;
}

function closedShell(): SessionShellModel {
  return {
    shell_profile: 'closed',
    default_route: '/select-org',
    visible_nav_items: [],
    income_onboarding_complete: false,
    available_navigation: [],
    available_modules: [],
    available_actions: [],
  };
}

function incomeModuleNavItem(moduleAppNavItems: NavItemDto[]): NavItemDto {
  return (
    moduleAppNavItems.find((n) => n.path === '/m/income') ?? {
      path: '/m/income',
      label: 'הכנסות',
      order: 50,
    }
  );
}

export function computeSessionShellFromModules(params: {
  commercialModuleCodes: string[];
  permissions: string[];
  allCoreNavItems: NavItemDto[];
  moduleAppNavItems: NavItemDto[];
  incomeOnboardingComplete: boolean;
}): SessionShellModel {
  const incomeOnly =
    params.commercialModuleCodes.length === 1 &&
    isIncomeCommercialModuleCode(params.commercialModuleCodes[0] ?? '');

  if (incomeOnly) {
    const incomeNav = { ...incomeModuleNavItem(params.moduleAppNavItems), order: 0 };
    const visible: NavItemDto[] = [incomeNav];
    if (canAccessSettings(params.permissions)) {
      const settings =
        params.allCoreNavItems.find((n) => n.path === '/settings') ?? {
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
      available_navigation: visible,
      available_modules: params.moduleAppNavItems.filter((item) => item.path === '/m/income'),
      available_actions: officeAdminActionsForPermissions(params.permissions),
    };
  }

  const visible = [...params.allCoreNavItems, ...params.moduleAppNavItems].sort(
    (a, b) => a.order - b.order,
  );

  return {
    shell_profile: 'full_platform',
    default_route: '/dashboard',
    visible_nav_items: visible,
    income_onboarding_complete: params.incomeOnboardingComplete,
    available_navigation: visible,
    available_modules: params.moduleAppNavItems,
    available_actions: officeAdminActionsForPermissions(params.permissions),
  };
}

/**
 * Role shell on top of the existing module shell.
 * Owner/Admin keep the current office navigation.
 * Staff/Viewer receive Modules plus the org's current module apps, and no office-admin actions.
 * Missing role or inactive membership fails closed.
 */
export function resolveSessionNavigation(params: {
  roleCode: string | null | undefined;
  membershipActive: boolean;
  permissions: string[];
  allCoreNavItems: NavItemDto[];
  moduleAppNavItems: NavItemDto[];
  commercialModuleCodes: string[];
  incomeOnboardingComplete: boolean;
}): SessionShellModel {
  const role = String(params.roleCode ?? '').trim().toLowerCase();
  if (!params.membershipActive || !role) return closedShell();
  if (OFFICE_ADMIN_ROLES.has(role)) {
    return computeSessionShellFromModules({
      commercialModuleCodes: params.commercialModuleCodes,
      permissions: params.permissions,
      allCoreNavItems: params.allCoreNavItems,
      moduleAppNavItems: params.moduleAppNavItems,
      incomeOnboardingComplete: params.incomeOnboardingComplete,
    });
  }
  if (!WORKER_ROLES.has(role)) return closedShell();
  const visible = [WORKER_MODULES_NAV, ...params.moduleAppNavItems].sort((a, b) => a.order - b.order);
  return {
    shell_profile: 'worker',
    default_route: '/modules',
    visible_nav_items: visible,
    income_onboarding_complete: params.incomeOnboardingComplete,
    available_navigation: visible,
    available_modules: params.moduleAppNavItems,
    available_actions: [],
  };
}
