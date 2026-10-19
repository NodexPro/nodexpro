export type OfficeModulePlanLimit = {
  limitCode: string;
  limitValue: number | null;
  isUnlimited: boolean;
};

export type OfficeModulePlan = {
  id: string;
  code: string;
  name: string;
  billingPeriod: string;
  currency: string;
  priceAmount: number;
  sortOrder: number;
  limits: OfficeModulePlanLimit[];
};

export type OfficeModuleSubscription = {
  id: string;
  modulePlanId: string;
  planName: string;
  currency: string;
  priceAmount: number;
  status: string;
  startedAt: string;
  endsAt: string | null;
};

export type OfficeModuleStateItem = {
  moduleId: string;
  code: string;
  name: string;
  version: string;
  scopeType: string;
  category: string | null;
  dependencies: string[];
  entitlementStatus: string;
  activationStatus: string;
  canActivate: boolean;
  canDeactivate: boolean;
  blockReason: string | null;
  navPath: string | null;
  navLabel: string | null;
  navOrder: number;
  isSystem: boolean;
  availablePlans: OfficeModulePlan[];
  currentSubscription: OfficeModuleSubscription | null;
  canSelectPlan: boolean;
  canChangePlan: boolean;
};

export type OfficeTrialState = {
  hasLegalIdentity: boolean;
  trialStatus: 'none' | 'not_started' | 'trialing' | 'trial_expired' | 'converted' | 'blocked';
  startedAt: string | null;
  endsAt: string | null;
  blocked: boolean;
};

export type OfficeModulesState = {
  trialState: OfficeTrialState;
  modules: OfficeModuleStateItem[];
};

export function commercialModules(modules: OfficeModuleStateItem[]): OfficeModuleStateItem[] {
  return modules.filter((module) => !module.isSystem);
}

export function subscribedCommercialModules(modules: OfficeModuleStateItem[]): OfficeModuleStateItem[] {
  return commercialModules(modules).filter((module) => module.currentSubscription != null);
}

export function matchingPlan(module: OfficeModuleStateItem): OfficeModulePlan | null {
  const planId = module.currentSubscription?.modulePlanId;
  if (!planId) return null;
  return module.availablePlans.find((plan) => plan.id === planId) ?? null;
}
