/**
 * Module catalog presentation keys. Does not change prices, entitlement, or activation.
 * UI translates these keys; fallback is the aggregate's existing name/reason string.
 */

export function moduleCatalogNameKey(moduleCode: string): string {
  return `modules.catalogName.${String(moduleCode ?? '').trim()}`;
}

export function modulePlanNameKey(planCode: string): string {
  return `modules.planName.${String(planCode ?? '').trim()}`;
}

export function moduleSubscriptionStatusKey(status: string): string {
  return `modules.subscriptionStatus.${String(status ?? '').trim()}`;
}

const BLOCK_REASON_KEYS: Record<string, string> = {
  NO_SUBSCRIPTION_OR_TRIAL: 'modules.blockReason.noSubscription',
  SUBSCRIPTION_ENDED: 'modules.blockReason.subscriptionEnded',
  SUBSCRIPTION_INACTIVE: 'modules.blockReason.subscriptionInactive',
  NOT_ENTITLED: 'modules.blockReason.notEntitled',
  MISSING_DEPENDENCIES: 'modules.blockReason.missingDependencies',
  'No subscription or trial for this module': 'modules.blockReason.noSubscription',
  'Subscription ended': 'modules.blockReason.subscriptionEnded',
  'Not entitled': 'modules.blockReason.notEntitled',
};

export function moduleBlockReasonKey(reason: string | null | undefined): string | null {
  const raw = String(reason ?? '').trim();
  if (!raw) return null;
  if (BLOCK_REASON_KEYS[raw]) return BLOCK_REASON_KEYS[raw];
  if (raw.startsWith('Subscription status:')) return 'modules.blockReason.subscriptionInactive';
  if (raw.startsWith('Missing dependencies:')) return 'modules.blockReason.missingDependencies';
  if (raw.startsWith('MISSING_DEPENDENCIES')) return 'modules.blockReason.missingDependencies';
  return null;
}

export function localizeCatalogCopy(
  key: string | null | undefined,
  fallback: string,
  t: (key: string) => string,
): string {
  const resolvedKey = String(key ?? '').trim();
  if (!resolvedKey) return fallback;
  const label = t(resolvedKey);
  return !label || label === resolvedKey ? fallback : label;
}

export function localizeModuleCatalogName(
  moduleCode: string,
  fallbackName: string,
  t: (key: string) => string,
): string {
  return localizeCatalogCopy(moduleCatalogNameKey(moduleCode), fallbackName, t);
}

export function localizeModulePlanName(
  planCode: string | null | undefined,
  fallbackName: string,
  t: (key: string) => string,
): string {
  const code = String(planCode ?? '').trim();
  if (!code) return fallbackName;
  return localizeCatalogCopy(modulePlanNameKey(code), fallbackName, t);
}

export function localizeModuleSubscriptionStatus(
  status: string,
  t: (key: string) => string,
): string {
  const raw = String(status ?? '').trim();
  return localizeCatalogCopy(moduleSubscriptionStatusKey(raw), raw, t);
}

export function localizeModuleBlockReason(
  reason: string | null | undefined,
  t: (key: string) => string,
): string | null {
  const raw = String(reason ?? '').trim();
  if (!raw) return null;
  const key = raw.startsWith('modules.blockReason.') ? raw : moduleBlockReasonKey(raw);
  if (!key) return raw;
  const label = localizeCatalogCopy(key, raw, t);
  if (key !== 'modules.blockReason.missingDependencies') return label;
  const deps = raw.replace(/^Missing dependencies:\s*/i, '').replace(/^MISSING_DEPENDENCIES:?\s*/i, '').replace(/^modules\.blockReason\.missingDependencies$/, '');
  if (!deps || deps === raw) return label.replace(' {{deps}}', '').replace('{{deps}}', '').trim();
  return label.includes('{{deps}}') ? label.replace('{{deps}}', deps) : `${label}: ${deps}`;
}

export const MODULE_ENTITLEMENT_ERROR_KEYS = {
  moduleNotActive: 'clientOperations.errors.moduleNotActive',
  moduleNotEntitled: 'clientOperations.errors.moduleNotEntitled',
  organizationContextRequired: 'clientOperations.errors.organizationContextRequired',
} as const;

export function isModuleEntitlementDenied(input: {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}): boolean {
  const code = String(input.code ?? '').trim();
  if (
    code === 'MODULE_NOT_ACTIVE'
    || code === 'MODULE_NOT_ENTITLED'
    || code === 'ORGANIZATION_CONTEXT_REQUIRED'
  ) {
    return true;
  }
  const message = String(input.message ?? '');
  return /Module not active for this organization|Not entitled to use this module|No subscription or trial for this module|Organization context required/i.test(
    message,
  );
}

export function moduleEntitlementErrorKey(input: {
  code?: string | null;
  message?: string | null;
}): string {
  const code = String(input.code ?? '').trim();
  if (code === 'MODULE_NOT_ACTIVE') return MODULE_ENTITLEMENT_ERROR_KEYS.moduleNotActive;
  if (code === 'MODULE_NOT_ENTITLED') return MODULE_ENTITLEMENT_ERROR_KEYS.moduleNotEntitled;
  if (code === 'ORGANIZATION_CONTEXT_REQUIRED') return MODULE_ENTITLEMENT_ERROR_KEYS.organizationContextRequired;
  const message = String(input.message ?? '');
  if (/Module not active for this organization/i.test(message)) return MODULE_ENTITLEMENT_ERROR_KEYS.moduleNotActive;
  if (/No subscription or trial for this module|Not entitled to use this module/i.test(message)) {
    return MODULE_ENTITLEMENT_ERROR_KEYS.moduleNotEntitled;
  }
  if (/Organization context required/i.test(message)) return MODULE_ENTITLEMENT_ERROR_KEYS.organizationContextRequired;
  return MODULE_ENTITLEMENT_ERROR_KEYS.moduleNotActive;
}
