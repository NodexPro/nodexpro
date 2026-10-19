import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commercialModules,
  matchingPlan,
  subscribedCommercialModules,
  type OfficeModuleStateItem,
} from '../src/modules/office-modules-state.ts';

function module(partial: Partial<OfficeModuleStateItem> & Pick<OfficeModuleStateItem, 'moduleId' | 'name'>): OfficeModuleStateItem {
  return {
    code: partial.code ?? partial.moduleId,
    version: '1',
    scopeType: 'organization',
    category: null,
    dependencies: [],
    entitlementStatus: 'not_entitled',
    activationStatus: 'inactive',
    canActivate: false,
    canDeactivate: false,
    blockReason: null,
    navPath: null,
    navLabel: null,
    navOrder: 0,
    isSystem: false,
    availablePlans: [],
    currentSubscription: null,
    canSelectPlan: false,
    canChangePlan: false,
    ...partial,
  };
}

test('commercial catalog hides system modules without inventing prices', () => {
  const rows = commercialModules([
    module({ moduleId: 'sys', name: 'Core', isSystem: true }),
    module({ moduleId: 'co', name: 'Client Operations' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].moduleId, 'co');
});

test('subscribed list uses backend currentSubscription only', () => {
  const rows = subscribedCommercialModules([
    module({
      moduleId: 'co',
      name: 'Client Operations',
      currentSubscription: {
        id: 's1',
        modulePlanId: 'p1',
        planName: 'Standard',
        currency: 'ILS',
        priceAmount: 120,
        status: 'active',
        startedAt: '2026-01-01',
        endsAt: null,
      },
    }),
    module({ moduleId: 'df', name: 'DocFlow' }),
    module({
      moduleId: 'sys',
      name: 'Core',
      isSystem: true,
      currentSubscription: {
        id: 's2',
        modulePlanId: 'p0',
        planName: 'System',
        currency: 'ILS',
        priceAmount: 0,
        status: 'active',
        startedAt: '2026-01-01',
        endsAt: null,
      },
    }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].moduleId, 'co');
});

test('matchingPlan looks up the subscribed plan without summing prices', () => {
  const item = module({
    moduleId: 'co',
    name: 'Client Operations',
    availablePlans: [
      {
        id: 'p1',
        code: 'std',
        name: 'Standard',
        billingPeriod: 'month',
        currency: 'ILS',
        priceAmount: 120,
        sortOrder: 1,
        limits: [],
      },
      {
        id: 'p2',
        code: 'yr',
        name: 'Yearly',
        billingPeriod: 'year',
        currency: 'ILS',
        priceAmount: 1200,
        sortOrder: 2,
        limits: [],
      },
    ],
    currentSubscription: {
      id: 's1',
      modulePlanId: 'p2',
      planName: 'Yearly',
      currency: 'ILS',
      priceAmount: 1200,
      status: 'active',
      startedAt: '2026-01-01',
      endsAt: null,
    },
  });
  const plan = matchingPlan(item);
  assert.equal(plan?.id, 'p2');
  assert.equal(plan?.billingPeriod, 'year');
});
