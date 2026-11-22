/**
 * Backend session_state=needs_onboarding is membership-empty, not a client fallback.
 * Login must not create an organization.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('session aggregate sets needs_onboarding only when the user has no memberships', () => {
  const routes = read('apps/api/src/domains/auth/auth.routes.ts');
  const start = routes.indexOf('function toAuthSessionAggregate');
  const end = routes.indexOf('async function resolveSessionMfa');
  const aggregate = routes.slice(start, end);
  assert.match(aggregate, /if \(me\.organizations\.length === 0\)/);
  assert.match(aggregate, /session_state: 'needs_onboarding'/);
  assert.match(aggregate, /redirect_to: '\/onboarding'/);
  assert.match(aggregate, /allowed_actions: \['create_organization'\]/);
  assert.doesNotMatch(aggregate, /insert\(/);
});

test('login and register do not auto-create an organization', () => {
  const service = read('apps/api/src/domains/auth/auth.service.ts');
  const loginFn = service.slice(service.indexOf('export async function login'), service.indexOf('export async function ensureAppUser'));
  assert.doesNotMatch(loginFn, /from\('organizations'\)/);
  assert.doesNotMatch(loginFn, /createOrganization/);
  const ensureAppUser = service.slice(service.indexOf('export async function ensureAppUser'));
  assert.doesNotMatch(ensureAppUser, /from\('organizations'\)/);
  assert.doesNotMatch(ensureAppUser, /from\('memberships'\)/);
  const login = read('apps/web/src/pages/Login.tsx');
  assert.doesNotMatch(login, /ORGS/);
  assert.doesNotMatch(login, /create_organization/);
});
