/**
 * Commercial module entitlement aliases.
 * Route/product code `income` is served by legacy catalog module `invoice` (ILS 60).
 */

export const MODULE_ENTITLEMENT_ALIASES: Readonly<Record<string, string>> = {
  income: 'invoice',
};

/** Resolve DB catalog code used for organization_modules + subscriptions checks. */
export function resolveModuleEntitlementCode(requestedModuleCode: string): string {
  const key = requestedModuleCode.trim();
  return MODULE_ENTITLEMENT_ALIASES[key] ?? key;
}

/** Whether org commercial module list represents Income-only shell. */
export function isIncomeCommercialModuleCode(code: string): boolean {
  return code === 'income' || code === 'invoice';
}
