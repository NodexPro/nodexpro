import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRowMatchesIssuerScope, type ActiveIncomeIssuerScope } from '../../src/domains/income/income.guards.js';

const selfScope: ActiveIncomeIssuerScope = {
  org_id: 'a1111111-1111-4111-8111-111111111111',
  actor_user_id: 'b2222222-2222-4222-8222-222222222222',
  acting_mode: 'self',
  issuer_business_id: 'c3333333-3333-4333-8333-333333333333',
  represented_client_id: null,
  issuer_label: 'Office',
  represented_client_label: null,
  permissions: { view: true, edit: true, issue: true, issue_on_behalf: true },
};

const officeScope: ActiveIncomeIssuerScope = {
  ...selfScope,
  acting_mode: 'office_representative',
  issuer_business_id: 'd4444444-4444-4444-8444-444444444444',
  represented_client_id: 'd4444444-4444-4444-8444-444444444444',
  represented_client_label: 'Client ABC',
};

test('self mode row matches self issuer scope', () => {
  assert.doesNotThrow(() =>
    assertRowMatchesIssuerScope(selfScope, {
      organization_id: selfScope.org_id,
      issuer_business_id: selfScope.issuer_business_id,
      represented_client_id: null,
    }),
  );
});

test('office mode row matches represented client scope', () => {
  assert.doesNotThrow(() =>
    assertRowMatchesIssuerScope(officeScope, {
      organization_id: officeScope.org_id,
      issuer_business_id: officeScope.issuer_business_id,
      represented_client_id: officeScope.represented_client_id,
    }),
  );
});

test('draft cannot match wrong issuer context', () => {
  assert.throws(() =>
    assertRowMatchesIssuerScope(selfScope, {
      organization_id: selfScope.org_id,
      issuer_business_id: officeScope.issuer_business_id,
      represented_client_id: officeScope.represented_client_id,
    }),
  );
});

test('office scope rejects self-scoped customer row', () => {
  assert.throws(() =>
    assertRowMatchesIssuerScope(officeScope, {
      organization_id: officeScope.org_id,
      issuer_business_id: officeScope.issuer_business_id,
      represented_client_id: null,
    }),
  );
});
