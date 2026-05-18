import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionShellFromModules } from '../../src/domains/auth/session-shell.pure.js';

const coreNav = [
  { path: '/dashboard', label: 'Dashboard', order: 0 },
  { path: '/settings', label: 'Settings', order: 10 },
  { path: '/clients', label: 'Clients', order: 25 },
];

const moduleNav = [
  { path: '/m/income', label: 'הכנסות', order: 50 },
  { path: '/m/client-operations', label: 'Nodex לקוחות', order: 60 },
];

test('income-only commercial module set returns income_only shell', () => {
  const shell = computeSessionShellFromModules({
    commercialModuleCodes: ['income'],
    permissions: ['settings:read'],
    allCoreNavItems: coreNav,
    moduleAppNavItems: moduleNav,
    incomeOnboardingComplete: true,
  });
  assert.equal(shell.shell_profile, 'income_only');
  assert.equal(shell.default_route, '/m/income');
  assert.equal(shell.income_onboarding_complete, true);
  const paths = shell.visible_nav_items.map((n) => n.path);
  assert.deepEqual(paths, ['/m/income', '/settings']);
  assert.ok(!paths.includes('/dashboard'));
  assert.ok(!paths.includes('/clients'));
});

test('income-only incomplete onboarding routes to settings', () => {
  const shell = computeSessionShellFromModules({
    commercialModuleCodes: ['income'],
    permissions: [],
    allCoreNavItems: coreNav,
    moduleAppNavItems: moduleNav,
    incomeOnboardingComplete: false,
  });
  assert.equal(shell.default_route, '/settings');
  assert.equal(shell.income_onboarding_complete, false);
});

test('multiple commercial modules returns full_platform shell', () => {
  const shell = computeSessionShellFromModules({
    commercialModuleCodes: ['client-operations', 'income'],
    permissions: ['settings:read'],
    allCoreNavItems: coreNav,
    moduleAppNavItems: moduleNav,
    incomeOnboardingComplete: true,
  });
  assert.equal(shell.shell_profile, 'full_platform');
  assert.equal(shell.default_route, '/dashboard');
  const paths = shell.visible_nav_items.map((n) => n.path);
  assert.ok(paths.includes('/dashboard'));
  assert.ok(paths.includes('/m/income'));
  assert.ok(paths.includes('/m/client-operations'));
});
