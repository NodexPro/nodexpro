import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAllowedActingModes,
  buildIssuerOptions,
} from '../../src/domains/income/income-workspace-context.builders.js';
import type { IncomeWorkspacePermissions } from '../../src/domains/income/income.types.js';

const fullPerms: IncomeWorkspacePermissions = {
  view: true,
  edit: true,
  issue: true,
  issue_on_behalf: true,
};

test('buildAllowedActingModes always returns both modes (never empty)', () => {
  const modes = buildAllowedActingModes(fullPerms);
  assert.equal(modes.length, 2);
  assert.deepEqual(
    modes.map((m) => m.mode),
    ['self', 'office_representative'],
  );
  assert.ok(modes.every((m) => typeof m.label === 'string' && m.label.length > 0));
});

test('buildIssuerOptions returns self option when income.view is granted', () => {
  const options = buildIssuerOptions(
    {
      id: 'c3333333-3333-4333-8333-333333333333',
      organization_id: 'a1111111-1111-4111-8111-111111111111',
      display_name: 'Office',
      legal_name: 'Office Ltd',
    },
    [],
    { view: true, edit: false, issue: false, issue_on_behalf: false },
  );
  assert.ok(options.length >= 1);
  assert.equal(options[0]?.acting_mode, 'self');
  assert.equal(options[0]?.represented_client_id, null);
});

test('select command contract: refreshed aggregate uses same builders as GET', () => {
  const modes = buildAllowedActingModes(fullPerms);
  const options = buildIssuerOptions(
    {
      id: 'c3333333-3333-4333-8333-333333333333',
      organization_id: 'a1111111-1111-4111-8111-111111111111',
      display_name: 'Office',
      legal_name: null,
    },
    [
      {
        id: 'd4444444-4444-4444-8444-444444444444',
        display_name: 'Client ABC',
        legal_name: null,
        is_archived: false,
      },
    ],
    fullPerms,
  );
  assert.equal(modes.length, 2);
  assert.equal(options.length, 2);
});
