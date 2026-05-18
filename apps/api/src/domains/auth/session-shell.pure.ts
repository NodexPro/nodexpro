/**
 * Pure session shell decision (no I/O).
 */

export type ShellProfile = 'income_only' | 'full_platform';

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
    params.commercialModuleCodes.length === 1 && params.commercialModuleCodes[0] === 'income';

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
  };
}
