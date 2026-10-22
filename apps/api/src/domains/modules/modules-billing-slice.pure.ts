/**
 * Backend-owned billing presentation slice from modules-state truth.
 * Does not change entitlement or subscription records.
 */

export type BillingSliceModule = {
  moduleId: string;
  name: string;
  isSystem: boolean;
  activationStatus: string;
  availablePlans: Array<{ id: string; billingPeriod: string }>;
  currentSubscription: {
    modulePlanId: string;
    currency: string;
    priceAmount: number;
    startedAt: string;
    endsAt: string | null;
  } | null;
};

export type ModulesBillingSubscriptionRow = {
  module_id: string;
  name: string;
  activation_status: string;
  billing_period: string | null;
  currency: string;
  price_amount: number;
  started_at: string;
  ends_at: string | null;
};

export function buildModulesBillingSlice(modules: BillingSliceModule[]): {
  subscribed_commercial_modules: ModulesBillingSubscriptionRow[];
} {
  const subscribed_commercial_modules: ModulesBillingSubscriptionRow[] = [];
  for (const module of modules) {
    if (module.isSystem || !module.currentSubscription) continue;
    const plan =
      module.availablePlans.find((p) => p.id === module.currentSubscription!.modulePlanId) ?? null;
    subscribed_commercial_modules.push({
      module_id: module.moduleId,
      name: module.name,
      activation_status: module.activationStatus,
      billing_period: plan?.billingPeriod ?? null,
      currency: module.currentSubscription.currency,
      price_amount: module.currentSubscription.priceAmount,
      started_at: module.currentSubscription.startedAt,
      ends_at: module.currentSubscription.endsAt,
    });
  }
  return { subscribed_commercial_modules };
}
