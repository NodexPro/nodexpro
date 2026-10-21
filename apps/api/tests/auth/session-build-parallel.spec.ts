import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('session org-id listing runs membership and legacy OU reads in parallel', () => {
  const src = readFileSync(join(root, 'src/domains/auth/active-organization.service.ts'), 'utf8');
  assert.match(src, /export async function listUserActiveOrganizationIds/);
  assert.match(src, /Promise\.all\(\[[\s\S]*organization_memberships[\s\S]*organization_users/);
});

test('session shell does not wait sequentially on income onboarding then commercial modules', () => {
  const src = readFileSync(join(root, 'src/domains/auth/session-shell.service.ts'), 'utf8');
  assert.match(src, /preloadedIncomeOnboardingComplete/);
  assert.match(src, /preloadedCommercialModuleCodes/);
  assert.match(src, /Promise\.all\(\[[\s\S]*isIncomeOnboardingComplete[\s\S]*loadActiveCommercialModuleCodes/);
});

test('auth session aggregate loads org list, preferences, modules, and income onboarding together', () => {
  const src = readFileSync(join(root, 'src/domains/auth/auth.routes.ts'), 'utf8');
  assert.match(src, /Promise\.all\(\[[\s\S]*listUserActiveOrganizationIds[\s\S]*loadSessionPreferenceSlices/);
  assert.match(src, /Promise\.all\(\[[\s\S]*isIncomeOnboardingComplete/);
  assert.match(src, /preloadedIncomeOnboardingComplete/);
  assert.match(src, /preloadedCommercialModuleCodes/);
  assert.doesNotMatch(src, /const preferenceSlices = await loadSessionPreferenceSlices\(ctx\);/);
});
