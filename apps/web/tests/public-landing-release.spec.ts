import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/i18n/en.json';
import he from '../src/i18n/he.json';
import {
  formatLandingPriceDisplay,
  formatLandingTrialLabel,
  localizeLineList,
  parseCookieValue,
  resolvePublicUiLang,
} from '../src/lib/public-ui-lang.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

function walkStrings(node: unknown, prefix = ''): Array<{ key: string; value: string }> {
  if (typeof node === 'string') return [{ key: prefix, value: node }];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    walkStrings(v, prefix ? `${prefix}.${k}` : k),
  );
}

test('language resolver: stored preference wins, IL is Hebrew, unknown is English', () => {
  assert.equal(resolvePublicUiLang({ stored: 'en', geoCountry: 'IL' }), 'en');
  assert.equal(resolvePublicUiLang({ stored: 'he', geoCountry: 'US' }), 'he');
  assert.equal(resolvePublicUiLang({ stored: 'ru', geoCountry: 'IL' }), 'ru');
  assert.equal(resolvePublicUiLang({ stored: null, geoCountry: 'IL' }), 'he');
  assert.equal(resolvePublicUiLang({ stored: null, geoCountry: 'US' }), 'en');
  assert.equal(resolvePublicUiLang({ stored: null, geoCountry: null }), 'en');
  assert.equal(resolvePublicUiLang({ stored: 'de', geoCountry: 'FR' }), 'en');
});

test('cookie parser reads nx-geo-country without treating browser language as geo', () => {
  assert.equal(parseCookieValue('nx-geo-country=IL; nx-lang=en', 'nx-geo-country'), 'IL');
  assert.equal(parseCookieValue('foo=1; nx-geo-country=US', 'nx-geo-country'), 'US');
  assert.equal(parseCookieValue('nx-lang=he', 'nx-geo-country'), null);
  const provider = read('src/i18n/I18nProvider.tsx');
  assert.match(provider, /resolvePublicUiLang/);
  assert.doesNotMatch(provider, /navigator\.language|Intl\.DateTimeFormat|timeZone/);
});

test('landing chrome keys exist in English and Hebrew and do not leak the other language', () => {
  const enLanding = walkStrings((en as { landing: unknown }).landing);
  const heLanding = walkStrings((he as { landing: unknown }).landing);
  assert.deepEqual(
    enLanding.map((x) => x.key).sort(),
    heLanding.map((x) => x.key).sort(),
  );
  const englishOnly = /Get Started|Available now|Coming soon|Powerful modules|All Your Business/;
  for (const row of heLanding) {
    if (row.key === 'lang.en' || row.key.endsWith('.title') && /Work Engine|Tax Brain|DocFlow/.test(row.value)) {
      continue;
    }
    if (row.key === 'catalog.docflow.name') continue;
    assert.doesNotMatch(row.value, englishOnly, row.key);
  }
  assert.equal((he as { landing: { getStarted: string } }).landing.getStarted, 'התחילו עכשיו');
  assert.equal((he as { landing: { availableNow: string } }).landing.availableNow, 'זמין עכשיו');
});

test('landing CTA routes stay /register and /login', () => {
  const page = read('src/pages/LandingPage.tsx');
  assert.match(page, /to="\/register"/);
  assert.match(page, /to="\/login"/);
  assert.match(page, /<\/section>\s*<LandingModuleShowcase \/>\s*<section className="nx-landing__modules"/);
  assert.match(page, /dir=\{dir\}/);
  assert.match(page, /PublicLanguageSwitch/);
});

test('hero is a fluid grid with a separate art layer and no 72px monitor lock', () => {
  const css = read('src/styles/nx-landing.css');
  assert.match(css, /grid-template-areas:\s*'copy art'/);
  assert.match(css, /\.nx-landing__hero-art \{/);
  assert.match(css, /background-size:\s*contain/);
  assert.match(css, /clamp\(/);
  assert.match(css, /minmax\(/);
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.doesNotMatch(css, /72px/);
  assert.doesNotMatch(css, /background-size:\s*cover/);
  assert.match(css, /border-radius: 6px/);
});

test('Sign in reuses the Create account glass shell', () => {
  const login = read('src/pages/Login.tsx');
  const register = read('src/pages/Register.tsx');
  assert.match(login, /PublicAuthShell/);
  assert.match(register, /PublicAuthShell/);
  assert.match(login, /signInWithIdentifier/);
  assert.match(login, /AUTH\.mfaCommand\('verify_mfa'\)/);
  assert.doesNotMatch(login, /style=\{\{ maxWidth: 400/);
  assert.match(read('src/components/auth/PublicAuthShell.tsx'), /nx-glass-auth nx-office-ocean nx-register-ocean/);
});

test('showcase still reads backend catalog and does not invent prices', () => {
  const src = read('src/components/landing/LandingModuleShowcase.tsx');
  assert.match(src, /fetchLandingModuleShowcase/);
  assert.match(src, /mod\.price\.amount/);
  assert.match(src, /mod\.price\.currency/);
  assert.match(src, /mod\.availability/);
  assert.doesNotMatch(src, /₪|\bILS\b|\$\d|\b(99|49|60)\b|\bfree\b/i);
  assert.match(read('src/api/public-catalog.ts'), /apiJsonPublic<LandingModuleShowcaseAggregate>\('\/public\/landing-module-showcase'\)/);
});

test('price presentation uses backend amount/currency and i18n period labels', () => {
  const display = formatLandingPriceDisplay({
    amount: 99,
    currency: 'ILS',
    billingPeriod: 'month',
    locale: 'he',
    periodLabel: 'לחודש',
  });
  assert.match(display, /99/);
  assert.match(display, /לחודש/);
  const trial = formatLandingTrialLabel(2, (key) =>
    key === 'landing.trial.months' ? 'First {n} months free' : key,
  );
  assert.equal(trial, 'First 2 months free');
  assert.deepEqual(localizeLineList((key) => (key.endsWith('.0') ? 'שורה' : key), 'x', ['raw']), ['שורה']);
});

test('middleware stores Vercel country and never overwrites nx-lang', () => {
  const mw = read('middleware.js');
  assert.match(mw, /x-vercel-ip-country/);
  assert.match(mw, /nx-geo-country/);
  assert.match(mw, /nx-lang=/);
  assert.doesNotMatch(mw, /navigator\.language/);
});
