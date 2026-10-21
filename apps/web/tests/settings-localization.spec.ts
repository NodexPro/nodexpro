import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Settings uses Dashboard glass cards and does not reveal the current password', () => {
  const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
  const css = readFileSync(join(root, 'src/styles/nx-settings-deep-ocean.css'), 'utf8');
  assert.match(settings, /nx-settings-deep-ocean/);
  assert.match(settings, /account_security/);
  assert.match(settings, /password_indicator/);
  assert.match(settings, /#nx-account-security/);
  assert.match(settings, /nx-settings-pair/);
  assert.doesNotMatch(settings, /auth\.getUser\(\)[\s\S]*password/);
  assert.doesNotMatch(settings, /current_password/);
  assert.doesNotMatch(settings, /AUTH\.changePassword/);
  assert.match(settings, /resetPasswordForEmail/);
  assert.match(css, /#8edfff/i);
  assert.match(css, /#00d9ff/i);
  assert.match(css, /#ffffff/i);
  assert.match(css, /border-radius:\s*14px/);
  assert.match(css, /rgba\(210,\s*238,\s*255/);
  assert.match(css, /rgba\(70,\s*213,\s*255/);
});

test('Settings consolidates identity, profile localization, and document pairs', () => {
  const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
  assert.match(settings, /settings\.ownerIdentity\.section/);
  assert.match(settings, /settings\.accountSecurity\.section/);
  assert.match(settings, /settings\.profile\.section/);
  assert.match(settings, /settings\.profile\.country/);
  assert.match(settings, /settings\.localization\.currency/);
  assert.match(settings, /settings\.localization\.dateFormat/);
  assert.match(settings, /settings\.localization\.language/);
  assert.match(settings, /settings\.localization\.timezone/);
  assert.match(settings, /AUTH\.setLocalizationPreferences/);
  assert.match(settings, /settings\.documentIdentity\.section/);
  assert.match(settings, /settings\.bankDetails\.section/);
  assert.match(settings, /settings\.signature\.section/);
  assert.doesNotMatch(settings, /settings\.localization\.section/);
  assert.doesNotMatch(settings, /settings\.localization\.country/);
  assert.equal((settings.match(/settings\.profile\.country(?![A-Za-z])/g) ?? []).length, 2);
});

test('Owner console exposes Currencies and Languages routes without user sidebar entries', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const shell = readFileSync(join(root, 'src/pages/PlatformOwnerShell.tsx'), 'utf8');
  const template = readFileSync(join(root, 'src/templates/template-1/TemplateLayout.tsx'), 'utf8');
  assert.match(app, /path="currencies"/);
  assert.match(app, /path="languages"/);
  assert.match(app, /PlatformOwnerCurrenciesPage/);
  assert.match(app, /PlatformOwnerLanguagesPage/);
  assert.match(shell, /Currencies/);
  assert.match(shell, /Languages & Translations/);
  assert.doesNotMatch(template, /Currencies/);
  assert.doesNotMatch(template, /Languages & Translations/);
});

test('login uses identifier API helper instead of revealing alias mapping', () => {
  const helper = readFileSync(join(root, 'src/lib/sign-in-with-identifier.ts'), 'utf8');
  const login = readFileSync(join(root, 'src/pages/Login.tsx'), 'utf8');
  assert.match(helper, /AUTH\.login/);
  assert.match(login, /signInWithIdentifier/);
  assert.doesNotMatch(helper, /primaryEmail/);
});
