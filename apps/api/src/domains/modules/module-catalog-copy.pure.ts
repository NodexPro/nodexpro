/**
 * Ready-to-render catalog label keys. Presentation only — entitlement and prices stay unchanged.
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

export function moduleBlockReasonKeyFromEntitlement(
  entitlementReason: string | undefined,
  missingDeps: readonly string[],
): string | null {
  if (missingDeps.length > 0) return 'modules.blockReason.missingDependencies';
  const reason = String(entitlementReason ?? '').trim();
  if (reason === 'No subscription or trial for this module' || reason === 'NO_SUBSCRIPTION_OR_TRIAL') {
    return 'modules.blockReason.noSubscription';
  }
  if (reason === 'Subscription ended' || reason === 'SUBSCRIPTION_ENDED') {
    return 'modules.blockReason.subscriptionEnded';
  }
  if (reason.startsWith('Subscription status:') || reason === 'SUBSCRIPTION_INACTIVE') {
    return 'modules.blockReason.subscriptionInactive';
  }
  if (reason === 'Not entitled' || reason === 'NOT_ENTITLED') return 'modules.blockReason.notEntitled';
  return reason ? 'modules.blockReason.notEntitled' : null;
}
