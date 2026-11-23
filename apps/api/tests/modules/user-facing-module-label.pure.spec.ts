import test from 'node:test';
import assert from 'node:assert/strict';
import { userFacingModuleDisplayName } from '../../src/domains/modules/user-facing-module-label.pure.js';
import { projectModuleAssignability } from '../../src/domains/modules/member-module-assignability.pure.js';

test('Users & Roles tables show Client Management / ניהול לקוחות, not Client Operations', () => {
  assert.equal(userFacingModuleDisplayName('client-operations', 'en', 'Client Operations'), 'Client Management');
  assert.equal(userFacingModuleDisplayName('client-operations', 'he', 'Client Operations'), 'ניהול לקוחות');
  assert.equal(userFacingModuleDisplayName('invoice', 'en', 'Income'), 'Income');
  const projected = projectModuleAssignability({
    row: {
      id: 'm1',
      code: 'client-operations',
      name: 'Client Operations',
      is_active: true,
      is_system: false,
      nav_path: '/m/client-operations',
    },
    organizationEntitled: true,
    memberEnabled: true,
    locale: 'he',
  });
  assert.equal(projected.display_name, 'ניהול לקוחות');
});
