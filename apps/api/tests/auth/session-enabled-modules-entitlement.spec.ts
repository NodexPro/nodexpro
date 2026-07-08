/**
 * Session enabledModules must match requireModuleActive entitlement gate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const authRoutesSource = readFileSync(
  join(dir, '../../src/domains/auth/auth.routes.ts'),
  'utf8',
);
const entitlementSource = readFileSync(
  join(dir, '../../src/domains/modules/entitlement.service.ts'),
  'utf8',
);
const requireModuleActiveSource = readFileSync(
  join(dir, '../../src/middleware/requireModuleActive.ts'),
  'utf8',
);
const authContextSource = readFileSync(
  join(dir, '../../../web/src/contexts/AuthContext.tsx'),
  'utf8',
);
const appShellSource = readFileSync(
  join(dir, '../../../web/src/components/layout/AppShell.tsx'),
  'utf8',
);

test('session entitlement gate matches requireModuleActive (entitled or trial only)', () => {
  assert.match(entitlementSource, /return status === 'entitled' \|\| status === 'trial'/);
  assert.match(
    requireModuleActiveSource,
    /entitlement\.status !== 'entitled' && entitlement\.status !== 'trial'/,
  );
});

test('session builder filters enabledModules through filterSessionEnabledModuleCodes', () => {
  assert.match(authRoutesSource, /filterSessionEnabledModuleCodes\(/);
  assert.match(authRoutesSource, /organization_modules/);
});

test('moduleAppNavItems are also entitlement-filtered (client-operations nav hidden when not entitled)', () => {
  assert.match(authRoutesSource, /if \(!entitledCodes\.has\(m\.code\)\) continue/);
});

test('expired or missing entitlement excludes module from enabledModules', () => {
  assert.match(
    authRoutesSource,
    /\.filter\(\(code\) => entitledCodes\.has\(code\)\)/,
  );
  assert.match(entitlementSource, /isSessionEnabledModuleEntitlementStatus\(entitlement\.status\)/);
});

test('session builder does not assign enabledModules directly from active rows without entitlement filter', () => {
  assert.doesNotMatch(
    authRoutesSource,
    /enabledModules = modList\.map\(\(m\) => rowMod\(m\.modules\)\?\.code\)/,
  );
});

test('permissions list is built before enabledModules and not filtered by entitlement', () => {
  const permissionsAssign = authRoutesSource.indexOf('let permissions =');
  const enabledAssign = authRoutesSource.indexOf('let enabledModules');
  assert.ok(permissionsAssign >= 0 && enabledAssign > permissionsAssign);
  assert.doesNotMatch(authRoutesSource, /permissions = permissions\.filter/);
  assert.doesNotMatch(authRoutesSource, /permissions\.filter\([\s\S]*entitlement/);
});

test('filterSessionEnabledModuleCodes reuses resolveEntitlementsForOrganization batch helper', () => {
  assert.match(entitlementSource, /resolveEntitlementsForOrganization/);
  assert.match(entitlementSource, /isSessionEnabledModuleEntitlementStatus/);
});

test('AuthContext isMeEqual compares enabledModules and permissions for stale session protection', () => {
  assert.match(authContextSource, /sortedStringArrayKey\(a\.permissions\)/);
  assert.match(authContextSource, /sortedStringArrayKey\(a\.enabledModules\)/);
});

test('ReminderToasts gate still uses session enabledModules only (no frontend entitlement logic)', () => {
  assert.match(appShellSource, /isClientOperationsReminderToastsEnabled\(/);
  assert.match(appShellSource, /enabledModules:\s*me\.enabledModules/);
  assert.doesNotMatch(appShellSource, /resolveEntitlement/);
});
