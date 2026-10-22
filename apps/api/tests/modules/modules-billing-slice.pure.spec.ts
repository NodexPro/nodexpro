import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModulesBillingSlice } from '../../src/domains/modules/modules-billing-slice.pure.js';

test('billing slice lists only subscribed commercial modules and their matched plan period', () => {
  const slice = buildModulesBillingSlice([
    {
      moduleId: 'sys',
      name: 'Core',
      isSystem: true,
      activationStatus: 'active',
      availablePlans: [],
      currentSubscription: {
        modulePlanId: 'p0',
        currency: 'ILS',
        priceAmount: 0,
        startedAt: '2026-01-01',
        endsAt: null,
      },
    },
    {
      moduleId: 'income',
      name: 'Income',
      isSystem: false,
      activationStatus: 'active',
      availablePlans: [
        { id: 'p1', billingPeriod: 'month' },
        { id: 'p2', billingPeriod: 'year' },
      ],
      currentSubscription: {
        modulePlanId: 'p2',
        currency: 'ILS',
        priceAmount: 1200,
        startedAt: '2026-02-01',
        endsAt: '2027-02-01',
      },
    },
    {
      moduleId: 'idle',
      name: 'Idle',
      isSystem: false,
      activationStatus: 'inactive',
      availablePlans: [{ id: 'p3', billingPeriod: 'month' }],
      currentSubscription: null,
    },
  ]);

  assert.equal(slice.subscribed_commercial_modules.length, 1);
  assert.deepEqual(slice.subscribed_commercial_modules[0], {
    module_id: 'income',
    name: 'Income',
    activation_status: 'active',
    billing_period: 'year',
    currency: 'ILS',
    price_amount: 1200,
    started_at: '2026-02-01',
    ends_at: '2027-02-01',
  });
});
