import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Settings uses Dashboard glass cards and does not reveal the current password', () => {
  const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
  const css = readFileSync(join(root, 'src/styles/nx-settings-deep-ocean.css'), 'utf8');
  const dashboard = readFileSync(join(root, 'src/styles/nx-dashboard.css'), 'utf8');
  assert.match(settings, /nx-settings-deep-ocean/);
  assert.match(settings, /account_security/);
  assert.match(settings, /password_indicator/);
  assert.match(settings, /id="nx-account-security"/);
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
  assert.match(dashboard, /rgba\(248,\s*252,\s*255,\s*0\.2\)/);
  assert.match(css, /rgba\(248,\s*252,\s*255,\s*0\.2\)/);
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
  const autosaveHook = readFileSync(join(root, 'src/pages/useSettingsAutosave.ts'), 'utf8');
  assert.match(autosaveHook, /AUTH\.setLocalizationPreferences/);
  assert.match(settings, /settings\.documentIdentity\.section/);
  assert.match(settings, /settings\.bankDetails\.section/);
  assert.match(settings, /settings\.signature\.section/);
  assert.doesNotMatch(settings, /settings\.localization\.section/);
  assert.doesNotMatch(settings, /settings\.localization\.country/);
  assert.equal((settings.match(/settings\.profile\.country(?![A-Za-z])/g) ?? []).length, 2);
});

test('Company Identity is a five-row key/value table with masked secrets and secure reset', () => {
  const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
  const css = readFileSync(join(root, 'src/styles/nx-settings-deep-ocean.css'), 'utf8');
  const en = readFileSync(join(root, 'src/i18n/en.json'), 'utf8');
  const he = readFileSync(join(root, 'src/i18n/he.json'), 'utf8');
  const identityBlock = settings.slice(
    settings.indexOf('nx-settings-identity-table'),
    settings.indexOf('nx-account-security'),
  );
  assert.match(identityBlock, /legalIdLabelKey \?\? 'settings\.legalIdLabel\.teudatZehut'/);
  assert.match(identityBlock, /settings\.ownerIdentity\.status/);
  assert.match(identityBlock, /settings\.ownerIdentity\.trialStatus/);
  assert.match(identityBlock, /settings\.loginEmail/);
  assert.match(identityBlock, /settings\.passwordMasked/);
  assert.match(identityBlock, /password_indicator/);
  assert.match(identityBlock, /primary_email_verified/);
  assert.match(identityBlock, /requestPasswordReset/);
  assert.match(settings, /settings\.ownerIdentity\.identityNote/);
  assert.match(css, /nx-settings-identity-table/);
  assert.match(css, /grid-template-columns:\s*minmax\(7\.5rem, 38%\) minmax\(0, 1fr\)/);
  assert.match(en, /"retry": "Retry"/);
  assert.match(he, /"retry": "נסה שוב"/);
  const idOrder = [
    identityBlock.indexOf('legalIdLabelKey'),
    identityBlock.indexOf('settings.ownerIdentity.status'),
    identityBlock.indexOf('settings.ownerIdentity.trialStatus'),
    identityBlock.indexOf('settings.loginEmail'),
    identityBlock.indexOf('settings.passwordMasked'),
  ];
  assert.deepEqual(idOrder, [...idOrder].sort((a, b) => a - b));
});

test('Account & Security matches Company Identity rows and profile fields follow the approved order', () => {
  const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
  const css = readFileSync(join(root, 'src/styles/nx-settings-deep-ocean.css'), 'utf8');
  const securityBlock = settings.slice(
    settings.indexOf('id="nx-account-security"'),
    settings.indexOf('settings.profile.section'),
  );
  const profileBlock = settings.slice(
    settings.indexOf('nx-settings-profile-grid'),
    settings.indexOf('settings.documentIdentity.section'),
  );
  assert.match(securityBlock, /nx-settings-identity-table/);
  assert.match(securityBlock, /nx-settings-security-inline/);
  assert.match(securityBlock, /settings\.accountSecurity\.additionalEmail/);
  assert.match(securityBlock, /settings\.accountSecurity\.addEmail/);
  assert.match(securityBlock, /settings\.changePasswordAction/);
  assert.match(securityBlock, /settings\.accountSecurity\.sendResetLink/);
  assert.match(securityBlock, /AUTH\.requestAdditionalLoginEmail/);
  assert.match(securityBlock, /AUTH\.replaceAdditionalLoginEmail/);
  assert.match(securityBlock, /AUTH\.resendAdditionalLoginEmail/);
  assert.match(securityBlock, /AUTH\.removeAdditionalLoginEmail/);
  assert.match(securityBlock, /resetPasswordForEmail|requestPasswordReset/);
  assert.doesNotMatch(securityBlock, /<p className="nx-settings-muted">\{t\('settings\.accountSecurity\.additionalEmailHint'\)\}<\/p>/);
  assert.doesNotMatch(securityBlock, /<h3>\{t\('settings\.changePasswordAction'\)\}<\/h3>/);
  assert.match(css, /nx-settings-security-inline/);
  const profileOrder = [
    profileBlock.indexOf('settings.profile.organizationName'),
    profileBlock.indexOf('settings.profile.legalEntityType'),
    profileBlock.indexOf('legalIdNumber'),
    profileBlock.indexOf('settings.profile.country'),
    profileBlock.indexOf('settings.profile.addressLine1'),
    profileBlock.indexOf('settings.profile.city'),
    profileBlock.indexOf('settings.profile.addressLine2'),
    profileBlock.indexOf('settings.profile.postalCode'),
    profileBlock.indexOf('settings.profile.phone'),
    profileBlock.indexOf('settings.profile.website'),
    profileBlock.indexOf('settings.localization.language'),
    profileBlock.indexOf('settings.localization.timezone'),
    profileBlock.indexOf('settings.localization.dateFormat'),
    profileBlock.indexOf('settings.localization.currency'),
  ];
  assert.ok(profileOrder.every((index) => index >= 0));
  assert.deepEqual(profileOrder, [...profileOrder].sort((a, b) => a - b));
  assert.match(profileBlock, /addressLine2 \(optional\)|settings\.profile\.addressLine2/);
});

test('Settings loads one organization settings aggregate and shows a shell while it loads', () => {
  const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
  const autosave = readFileSync(join(root, 'src/pages/useSettingsAutosave.ts'), 'utf8');
  assert.match(settings, /apiJson<SettingsData>\(orgSettings\(orgId\)/);
  assert.equal((settings.match(/orgSettings\(orgId\)/g) ?? []).length, 1);
  assert.match(autosave, /orgSettings\(orgId\)/);
  assert.doesNotMatch(settings, /orgCountrySettings/);
  assert.doesNotMatch(autosave, /orgCountrySettings/);
  assert.doesNotMatch(settings, /if \(loading\) return/);
  assert.match(settings, /nx-settings-placeholder/);
  assert.match(settings, /settings\.errors\.retry/);
  assert.match(settings, /country_configuration/);
});

test('Settings V4 hides country-config card and uses safe domain autosave', () => {
  const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
  const hook = readFileSync(join(root, 'src/pages/useSettingsAutosave.ts'), 'utf8');
  const css = readFileSync(join(root, 'src/styles/nx-settings-deep-ocean.css'), 'utf8');
  const en = readFileSync(join(root, 'src/i18n/en.json'), 'utf8');
  const he = readFileSync(join(root, 'src/i18n/he.json'), 'utf8');
  assert.doesNotMatch(settings, /settings\.profile\.countryStatus/);
  assert.doesNotMatch(settings, /settings\.profile\.countryConfigured/);
  assert.doesNotMatch(settings, /settings\.localization\.save/);
  assert.doesNotMatch(settings, /nx-settings-actions--footer/);
  assert.doesNotMatch(settings, /t\('common\.save'\)/);
  assert.doesNotMatch(settings, /t\('common\.cancel'\)/);
  assert.match(settings, /settings\.profile\.countryIncomplete/);
  assert.equal((settings.match(/settings\.profile\.country(?![A-Za-z])/g) ?? []).length, 2);
  assert.match(settings, /useSettingsAutosave/);
  assert.match(settings, /changeField\('displayPhoneOnDocuments'/);
  assert.match(settings, /changeLoc\('language_code'/);
  assert.match(hook, /SETTINGS_AUTOSAVE_DEBOUNCE_MS/);
  assert.match(hook, /method: 'PATCH'/);
  assert.match(hook, /AUTH\.setLocalizationPreferences/);
  assert.match(hook, /beforeunload/);
  assert.match(hook, /mergeFormKeepingDirty/);
  assert.doesNotMatch(hook, /requestAdditionalLoginEmail|change_password|resetPasswordForEmail/);
  assert.match(css, /nx-settings-autosave/);
  assert.match(css, /accent-color:\s*#13bfd0/);
  assert.match(en, /"saving": "Saving…"/);
  assert.match(he, /"saving": "שומר…"/);
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

test('Settings isolates glass layers and uses a growing page main to avoid Cosmic Horizon paint holes', () => {
  const css = readFileSync(join(root, 'src/styles/nx-settings-deep-ocean.css'), 'utf8');
  const glass = readFileSync(join(root, 'src/styles/nx-glass-surface.css'), 'utf8');
  const layout = readFileSync(join(root, 'src/templates/template-1/TemplateLayout.tsx'), 'utf8');
  const auth = readFileSync(join(root, 'src/components/guards/RequireAuth.tsx'), 'utf8');
  assert.match(css, /isolation:\s*isolate/);
  assert.match(css, /transform:\s*translateZ\(0\)/);
  assert.match(glass, /t1-pageMain--settings/);
  assert.match(glass, /nx-session-boot/);
  assert.match(layout, /t1-pageMain--settings/);
  assert.match(auth, /nx-session-boot/);
  assert.doesNotMatch(auth, /return <div>Loading\.\.\.<\/div>/);
  assert.doesNotMatch(css, /t1-appShell--client-operations::after/);
});

test('login uses identifier API helper instead of revealing alias mapping', () => {
  const helper = readFileSync(join(root, 'src/lib/sign-in-with-identifier.ts'), 'utf8');
  const login = readFileSync(join(root, 'src/pages/Login.tsx'), 'utf8');
  assert.match(helper, /AUTH\.login/);
  assert.match(login, /signInWithIdentifier/);
  assert.doesNotMatch(helper, /primaryEmail/);
});
