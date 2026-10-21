/**
 * Office localization — one persisted user preference for the authenticated office.
 * Registration country is a first-time default only. Organization country never wins at read time.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultUiLanguageFromCountry,
  resolvePersistedUiLanguage,
} from '../../src/domains/platform-localization/platform-localization.pure.js';
import { buildSidebarAccountBlock } from '../../src/domains/auth/sidebar-account-block.pure.js';
import { buildUsersRolesUi } from '../../src/domains/memberships/users-roles-locale.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('1-2. first-time default: Israel → Hebrew, any other registration country → English', () => {
  assert.equal(defaultUiLanguageFromCountry('IL'), 'he');
  assert.equal(defaultUiLanguageFromCountry('US'), 'en');
  const orgs = read('apps/api/src/domains/organizations/organizations.service.ts');
  assert.match(orgs, /if \(!ctx\.user\.uiLanguage\)/);
  assert.match(orgs, /defaultUiLanguageFromCountry\(params\.countryCode\)/);
  assert.match(orgs, /\.is\('ui_language', null\)/);
  const register = read('apps/web/src/pages/Register.tsx');
  assert.doesNotMatch(register, /country/i);
  const ensure = read('apps/api/src/domains/auth/auth.service.ts');
  assert.match(ensure, /insert\(\{ auth_user_id: authUserId, email, full_name: fullName \?\? null, status: 'active' \}\)/);
  assert.doesNotMatch(ensure, /ui_language/);
});

test('3-4. explicit English is kept for an Israeli org; explicit Hebrew is kept regardless of country', () => {
  const israeliEnglish = buildSidebarAccountBlock({
    user: { email: 'a@b.c', fullName: 'Dana' },
    organizations: [{ id: 'org-1', name: 'Office' }],
    activeOrganizationId: 'org-1',
    shellProfile: 'full_platform',
    uiLanguage: 'en',
    activeOrganizationCountryCode: 'IL',
  });
  assert.equal(israeliEnglish.language_selector.current_value, 'en');
  assert.equal(resolvePersistedUiLanguage('en'), 'en');
  const hebrewUs = buildSidebarAccountBlock({
    user: { email: 'a@b.c', fullName: 'Dana' },
    organizations: [{ id: 'org-1', name: 'Office' }],
    activeOrganizationId: 'org-1',
    shellProfile: 'full_platform',
    uiLanguage: 'he',
    activeOrganizationCountryCode: 'US',
  });
  assert.equal(hebrewUs.language_selector.current_value, 'he');
  assert.equal(resolvePersistedUiLanguage('he'), 'he');
  assert.equal(buildUsersRolesUi(resolvePersistedUiLanguage('en')).text.title, 'Users & Roles');
  assert.equal(buildUsersRolesUi(resolvePersistedUiLanguage('he')).text.title, 'משתמשים והרשאות');
});

test('12. set_ui_language updates only ui_language and returns the refreshed session aggregate', () => {
  const routes = read('apps/api/src/domains/auth/auth.routes.ts');
  const command = routes.slice(routes.indexOf("router.post('/commands/set_ui_language'"));
  const body = command.slice(0, command.indexOf("router.post('/commands/set_localization_preferences'"));
  assert.match(body, /update\(\{ ui_language: languageCode, updated_at:/);
  assert.doesNotMatch(body, /country_code|display_currency_code|timezone|date_format/);
  assert.match(body, /buildMeResponse\(freshCtx\)/);
  assert.match(body, /toAuthSessionAggregate\(me\)/);
  assert.doesNotMatch(body, /\/auth\/session|getSession|refetchMe/);
});

test('13. language command and Users & Roles share persisted user language, not org country', () => {
  const agg = read('apps/api/src/domains/memberships/users-roles-aggregate.service.ts');
  assert.match(agg, /buildUsersRolesUi\(resolvePersistedUiLanguage\(ctx\.user\.uiLanguage\)\)/);
  assert.doesNotMatch(agg, /buildUsersRolesUi\(orgRow\?\.country_code\)/);
  const session = read('apps/api/src/domains/auth/session-preferences.service.ts');
  assert.match(session, /uiLanguage: resolvePersistedUiLanguage\(/);
  const sidebar = read('apps/api/src/domains/auth/sidebar-account-block.pure.ts');
  assert.match(sidebar, /language_selector: \{[\s\S]*visible: true/);
});
