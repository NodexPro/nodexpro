/**
 * Stage 5.4 — which role permission codes enter which catalog module.
 * income.* enters the commercial invoice module. Display names are not used.
 */

export function permissionGrantsModule(permissionCode: string, moduleCode: string): boolean {
  const permission = String(permissionCode ?? '').trim();
  const module = String(moduleCode ?? '').trim();
  if (!permission || !module) return false;
  if (module === 'client-operations' && permission.startsWith('client_operations.')) return true;
  if ((module === 'invoice' || module === 'income') && permission.startsWith('income.')) return true;
  if (module === 'docflow' && (permission.startsWith('docflow.') || permission.startsWith('docflow:'))) {
    return true;
  }
  if (module === 'work_engine' && permission.startsWith('work_engine.')) return true;
  return false;
}

export function rolePermissionsGrantModule(permissionCodes: readonly string[], moduleCode: string): boolean {
  return permissionCodes.some((code) => permissionGrantsModule(code, moduleCode));
}

/** Modules a role can enter today, from the canonical permission seeds. */
export const STAGE54_ROLE_MODULE_CODES = {
  staff: ['client-operations', 'invoice', 'docflow', 'work_engine'],
  viewer: ['client-operations', 'invoice', 'work_engine'],
} as const;
