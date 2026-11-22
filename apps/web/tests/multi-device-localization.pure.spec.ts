/**
 * Cross-device language, device logout, TOKEN_REFRESHED, and remount-loop contracts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideSessionLanguageApply } from '../src/lib/session-language-bootstrap.pure.ts';
import { deviceSignOutOptions, DEVICE_SIGNOUT_SCOPE } from '../src/lib/device-session.pure.ts';
import {
  shouldInvalidateInFlightSession,
  shouldRefetchSessionAfterAuthEvent,
} from '../src/lib/auth-identity-transition.pure.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('persisted HE on a second device beats localStorage EN; unpersisted HE public lang still wins', () => {
  assert.equal(
    decideSessionLanguageApply({ storedPublicLang: 'en', sessionLang: 'he', sessionPersisted: true }),
    'he',
  );
  assert.equal(
    decideSessionLanguageApply({ storedPublicLang: 'he', sessionLang: 'en', sessionPersisted: false }),
    'he',
  );
  assert.equal(
    decideSessionLanguageApply({ storedPublicLang: null, sessionLang: 'he', sessionPersisted: true }),
    'he',
  );
});

test('TOKEN_REFRESHED does not refetch, invalidate, or call set_ui_language', () => {
  assert.equal(shouldRefetchSessionAfterAuthEvent('token_refresh_same'), false);
  assert.equal(shouldInvalidateInFlightSession('token_refresh_same'), false);
  const sync = read('src/components/auth/SessionLanguageSync.tsx');
  assert.doesNotMatch(sync, /setUiLanguageCommand|set_ui_language/);
  assert.match(sync, /useLayoutEffect/);
  const auth = read('src/contexts/AuthContext.tsx');
  assert.match(auth, /TOKEN_REFRESHED for the same user keeps UI/);
});

test('login does not overwrite a persisted language and navigates once', () => {
  const login = read('src/pages/Login.tsx');
  assert.match(login, /localization\?\.language\?\.persisted/);
  assert.match(login, /didFinishLoginNavRef/);
  assert.match(login, /setUiLanguageCommand/);
  assert.match(login, /if \(persisted\)/);
});

test('AppShell remounts on user\/org only; SIGNED_IN generation bump does not reset identityEpoch', () => {
  const shell = read('src/components/layout/AppShell.tsx');
  assert.match(shell, /workspaceKey = `\$\{me\.user\.id\}:\$\{me\.activeOrganizationId \?\? ''\}`/);
  assert.doesNotMatch(shell, /identityEpoch\}`/);
  const auth = read('src/contexts/AuthContext.tsx');
  const bump = auth.slice(auth.indexOf('const bumpGeneration'), auth.indexOf('const applyAuthenticated'));
  assert.doesNotMatch(bump, /setIdentityEpoch/);
  assert.doesNotMatch(bump, /lastWorkspaceRef\.current = null/);
});

test('device logout is local scope so a second computer stays signed in', () => {
  assert.equal(DEVICE_SIGNOUT_SCOPE, 'local');
  assert.deepEqual(deviceSignOutOptions(), { scope: 'local' });
  const auth = read('src/contexts/AuthContext.tsx');
  const client = read('src/api/client.ts');
  assert.match(auth, /signOut\(deviceSignOutOptions\(\)\)/);
  assert.match(client, /signOut\(deviceSignOutOptions\(\)\)/);
  assert.doesNotMatch(auth, /supabase\.auth\.signOut\(\s*\)/);
  assert.doesNotMatch(client, /supabase\.auth\.signOut\(\s*\)/);
});

test('CreateOrganization still renders backend country/timezone labels only', () => {
  const page = read('src/pages/CreateOrganization.tsx');
  assert.match(page, /option\.label/);
  assert.doesNotMatch(page, /United States|United Kingdom|Israel/);
  assert.doesNotMatch(page, /Intl\.DisplayNames/);
});

test('Modules shows i18n legal-identity errors, not raw English', () => {
  const modules = read('src/pages/Modules.tsx');
  assert.match(modules, /userFacingApiMessage\(err\)/);
  assert.doesNotMatch(modules, /err instanceof Error \? err\.message/);
});
