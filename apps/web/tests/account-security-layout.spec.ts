import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hebrew = /[\u0590-\u05FF]/;
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('AppShell MFA prompt is a fixed overlay and does not reserve document-flow height', () => {
  const shell = read('src/components/layout/AppShell.tsx');
  const panel = read('src/security/AccountSecurityPanel.tsx');
  const css = read('src/security/account-security-panel.css');
  assert.match(shell, /<AccountSecurityPanel mode="prompt" \/>/);
  assert.match(panel, /if \(props\.mode === 'prompt'\) return null/);
  assert.match(panel, /nx-mfa-prompt-overlay/);
  assert.match(css, /\.nx-mfa-prompt-overlay \{[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.nx-mfa-prompt-overlay \{[\s\S]*?inset:\s*0/);
  assert.doesNotMatch(css, /margin-top:\s*8vh/);
  assert.doesNotMatch(css, /margin-top:\s*-/);
});

test('MFA chrome uses I18nProvider keys instead of hardcoded HE/EN', () => {
  const panel = read('src/security/AccountSecurityPanel.tsx');
  const prompt = read('src/security/MfaOnboardingPrompt.tsx');
  const en = JSON.parse(read('src/i18n/en.json')) as { settings: { accountSecurity: Record<string, string> } };
  const he = JSON.parse(read('src/i18n/he.json')) as { settings: { accountSecurity: Record<string, string> } };
  assert.match(panel, /useI18n/);
  assert.match(prompt, /useI18n/);
  assert.equal(hebrew.test(panel), false);
  assert.equal(hebrew.test(prompt), false);
  assert.equal(en.settings.accountSecurity.mfa, 'Two-factor authentication (MFA)');
  assert.equal(he.settings.accountSecurity.mfa, 'אימות דו־שלבי (MFA)');
  assert.equal(hebrew.test(en.settings.accountSecurity.mfaPromptTitle), false);
  assert.equal(hebrew.test(he.settings.accountSecurity.mfaPromptTitle), true);
  for (const key of ['mfa', 'mfaEnroll', 'mfaPromptTitle', 'mfaPromptDecline', 'mfaStatusOn', 'mfaStatusOff']) {
    assert.equal(typeof en.settings.accountSecurity[key], 'string', key);
    assert.equal(typeof he.settings.accountSecurity[key], 'string', key);
  }
});

test('Settings MFA lives in Account & Security under Change password', () => {
  const settings = read('src/pages/Settings.tsx');
  const securityBlock = settings.slice(
    settings.indexOf('id="nx-account-security"'),
    settings.indexOf('settings.profile.section'),
  );
  assert.match(securityBlock, /<AccountSecurityPanel mode="section" embedded \/>/);
  assert.ok(securityBlock.indexOf('settings.changePasswordAction') < securityBlock.indexOf('AccountSecurityPanel'));
  assert.equal((settings.match(/<AccountSecurityPanel /g) ?? []).length, 1);
});
