/**
 * Stage 5.5 — canonical rule: which catalog modules an Owner may assign to a member.
 *
 * Derived only from catalog metadata (modules.is_active / is_system / nav_path).
 * No display names, no frontend lists.
 *
 * - user_facing:     has a `/m/...` app route. Assignable (when the organization is entitled).
 * - infrastructure:  `is_system` with no `/m/...` route (Work Engine). Never a checkbox.
 *                    Staff/Viewer reach it only through a user-facing module that embeds it
 *                    (Income or Client Operations). It never widens access on its own.
 */

export type ModuleCatalogRow = {
  id: string;
  code: string;
  /** Display name from the catalog (never a price/plan). */
  name?: string | null;
  is_active: boolean;
  is_system: boolean;
  nav_path: string | null;
};

export type ModuleKind = 'user_facing' | 'infrastructure';

/** Embedding modules: a grant on any of these reaches infrastructure modules. */
export const INFRASTRUCTURE_HOST_MODULE_CODES = ['invoice', 'client-operations'] as const;

export function classifyModule(row: Pick<ModuleCatalogRow, 'is_system' | 'nav_path'>): ModuleKind {
  const hasAppRoute = String(row.nav_path ?? '').startsWith('/m/');
  return row.is_system && !hasAppRoute ? 'infrastructure' : 'user_facing';
}

export type ModuleAssignabilityProjection = {
  module_id: string;
  code: string;
  display_name: string;
  kind: ModuleKind;
  organization_entitled: boolean;
  member_assignable: boolean;
  member_enabled: boolean;
  navigation_available: boolean;
};

export function projectModuleAssignability(params: {
  row: ModuleCatalogRow;
  /** Org module is active AND entitled/trialing. */
  organizationEntitled: boolean;
  /** Effective access of the member (explicit grant, or derived for infrastructure). */
  memberEnabled: boolean;
}): ModuleAssignabilityProjection {
  const kind = classifyModule(params.row);
  const entitled = params.organizationEntitled && params.row.is_active;
  const assignable = kind === 'user_facing' && entitled;
  const enabled = entitled && params.memberEnabled;
  return {
    module_id: params.row.id,
    code: params.row.code,
    display_name: String(params.row.name ?? '').trim() || params.row.code,
    kind,
    organization_entitled: entitled,
    member_assignable: assignable,
    member_enabled: enabled,
    navigation_available:
      enabled && kind === 'user_facing' && String(params.row.nav_path ?? '').startsWith('/m/'),
  };
}

/**
 * Effective module ids of a Staff/Viewer: explicit grants on user-facing modules, plus
 * infrastructure modules when a host module is granted. Grants stored on infrastructure
 * rows (legacy backfill) are ignored — they are not assignable truth.
 */
export function deriveEffectiveMemberModuleIds(
  catalog: readonly ModuleCatalogRow[],
  grantedModuleIds: ReadonlySet<string>,
): Set<string> {
  const effective = new Set<string>();
  let hostGranted = false;
  for (const row of catalog) {
    if (classifyModule(row) !== 'user_facing') continue;
    if (!grantedModuleIds.has(row.id)) continue;
    effective.add(row.id);
    if ((INFRASTRUCTURE_HOST_MODULE_CODES as readonly string[]).includes(row.code)) hostGranted = true;
  }
  if (hostGranted) {
    for (const row of catalog) {
      if (classifyModule(row) === 'infrastructure') effective.add(row.id);
    }
  }
  return effective;
}

/** Module ids a caller may put in `enabled_modules`. Returns the offending ids. */
export function findNonAssignableModuleIds(
  catalog: readonly ModuleCatalogRow[],
  requestedModuleIds: readonly string[],
): string[] {
  const byId = new Map(catalog.map((row) => [row.id, row]));
  return requestedModuleIds.filter((id) => {
    const row = byId.get(id);
    return !row || !row.is_active || classifyModule(row) !== 'user_facing';
  });
}
