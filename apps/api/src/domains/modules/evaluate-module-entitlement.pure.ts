export type EvaluatedEntitlementStatus = 'entitled' | 'trial' | 'not_entitled' | 'expired';

export type EvaluatedModuleSubscription = {
  status: string;
  ends_at: string | null;
  trial_ends_at: string | null;
};

export function evaluateModuleEntitlement(input: {
  moduleFound: boolean;
  isSystem: boolean;
  subscription: EvaluatedModuleSubscription | null;
  trialValid: boolean;
  nowMs?: number;
}): { status: EvaluatedEntitlementStatus; reason?: string } {
  if (!input.moduleFound) return { status: 'not_entitled', reason: 'Module not found' };
  if (input.isSystem) return { status: 'entitled' };

  const now = input.nowMs ?? Date.now();
  const sub = input.subscription;
  if (sub) {
    if (sub.status === 'active' || sub.status === 'trialing') {
      if (sub.ends_at && new Date(sub.ends_at).getTime() < now) {
        return { status: 'expired', reason: 'Subscription ended' };
      }
      if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() < now) {
        return { status: 'expired', reason: 'Trial ended' };
      }
      if (sub.status === 'trialing') return { status: 'trial' };
      return { status: 'entitled' };
    }
    return { status: 'expired', reason: `Subscription status: ${sub.status}` };
  }

  if (input.trialValid) return { status: 'trial' };
  return { status: 'not_entitled', reason: 'No subscription or trial for this module' };
}
