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
  const header = read('src/components/public/PublicHeader.tsx');
  const shell = read('src/components/public/PublicSiteShell.tsx');
  assert.match(page, /to="\/register"/);
  assert.match(page, /to="\/login"/);
  assert.match(header, /to="\/register"/);
  assert.match(header, /to="\/login"/);
  assert.match(
    page,
    /<\/section>\s*<LandingModuleShowcase \/>\s*<section className="nx-landing__modules"/,
  );
  assert.match(page, /<\/section>\s*\n\s*<LandingSecurityTrust \/>/);
  assert.match(shell, /dir=\{dir\}/);
  assert.match(shell, /PublicHeader/);
  assert.match(shell, /PublicFooter/);
  assert.match(header, /PublicLanguageSwitch/);
});

test('hero is a full-bleed composition, not a contained art card', () => {
  const css = read('src/styles/nx-landing.css');
  const page = read('src/pages/LandingPage.tsx');
  const shell = read('src/styles/nx-public-shell.css');
  assert.match(css, /\.nx-landing__hero \{[\s\S]*background-image:\s*url\('\/nodexpro-hero\.png/);
  assert.match(css, /background-size:\s*auto 100%/);
  assert.match(css, /background-position:\s*right center/);
  assert.doesNotMatch(css, /\.nx-landing__hero-art/);
  assert.doesNotMatch(css, /grid-template-areas:\s*'copy art'/);
  assert.doesNotMatch(css, /background-size:\s*contain/);
  assert.doesNotMatch(page, /nx-landing__hero-art/);
  assert.doesNotMatch(page, /<br \/>\s*\{t\('landing\.heroTitleTail'\)\}/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /clamp\(/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /rgba\(19, 191, 208, 0\.78\)/);
  assert.match(css, /rgba\(54, 169, 198, 0\.62\)/);
  assert.doesNotMatch(css, /rgba\(128, 116, 242/);
  assert.match(shell, /padding: 12px 22px 10px/);
  assert.match(shell, /max-width:\s*none/);
  assert.match(shell, /\.nx-public-header__btn[\s\S]*min-height: 28px/);
  assert.match(shell, /rgba\(19, 191, 208, 0\.92\)/);
});

test('phone hero only: hologram in the upper band, copy+CTA as one lower block', () => {
  const css = read('src/styles/nx-landing.css');
  const page = read('src/pages/LandingPage.tsx');
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*justify-content:\s*flex-end/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*background-size:\s*auto 80%/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*background-position:\s*100% 0/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*flex-wrap:\s*nowrap/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*background: #13bfd0/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*background: #123756/);
  assert.match(page, /to="\/register"/);
  assert.match(page, /to="\/login"/);
  assert.doesNotMatch(page, /nx-landing__hero-art/);
  assert.doesNotMatch(css, /\.nx-landing__hero-art/);
  assert.doesNotMatch(css, /background-size:\s*contain/);
});

test('public language switch uses local flag marks, not remote images', () => {
  const sw = read('src/components/landing/PublicLanguageSwitch.tsx');
  const flags = read('src/components/public/PublicLanguageFlags.tsx');
  assert.match(sw, /EnglishLangFlag/);
  assert.match(sw, /HebrewLangFlag/);
  assert.match(sw, /aria-label=\{t\('landing\.lang\.en'\)\}/);
  assert.match(sw, /title=\{t\('landing\.lang\.he'\)\}/);
  assert.match(flags, /<svg /);
  assert.doesNotMatch(sw, /flagcdn|countryflags|twemoji|unpkg|jsdelivr/i);
  assert.doesNotMatch(flags, /https?:\/\//);
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

test('Security & Trust is a conservative i18n section with a future security_trust block id', () => {
  const page = read('src/pages/LandingPage.tsx');
  const src = read('src/components/landing/LandingSecurityTrust.tsx');
  const css = read('src/styles/nx-landing.css');
  const registry = read('src/components/landing/landing-security-trust.pure.ts');
  const landingEn = (en as { landing: { trust: { title: string; lead: string; cards: Record<string, { title: string; description: string }> } } }).landing.trust;
  const landingHe = (he as { landing: { trust: { title: string; lead: string; cards: Record<string, { title: string; description: string }> } } }).landing.trust;

  assert.match(page, /<LandingSecurityTrust \/>/);
  assert.match(registry, /LANDING_SECURITY_TRUST_BLOCK_TYPE = 'security_trust'/);
  assert.match(src, /landing\.trust\.title/);
  assert.match(src, /landing\.trust\.cards\.\$\{key\}\.title/);
  assert.doesNotMatch(src, /ISO|SOC 2|encrypted at rest|HIPAA|GDPR/i);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.nx-landing__trust-grid/);
  assert.equal(landingEn.title, 'Your Business Data Deserves Protection.');
  assert.equal(landingHe.title, 'המידע העסקי שלכם ראוי להגנה.');
  assert.equal(landingEn.cards.access.title, 'Controlled Access');
  assert.equal(landingHe.cards.access.title, 'בקרת גישה');
  assert.equal(landingEn.cards.ongoing.title, 'Security-Focused Development');
  assert.equal(
    landingEn.cards.ongoing.description,
    'Security considerations are incorporated into ongoing product development.',
  );
  assert.equal(landingHe.cards.ongoing.title, 'פיתוח עם דגש על אבטחה');
  assert.match(css, /\.nx-landing__modules-inner \{[\s\S]*?max-width:\s*none/);
  assert.match(css, /\.nx-landing__trust-inner \{[\s\S]*?max-width:\s*none/);
  assert.match(css, /margin-inline:\s*clamp\(24px, 2\.5vw, 32px\)/);
  for (const row of walkStrings(landingEn).concat(walkStrings(landingHe))) {
    assert.doesNotMatch(row.value, /ISO\s*27001|SOC\s*2|HIPAA|encrypted at rest|GDPR certified/i, row.key);
  }
});

test('middleware stores Vercel country and never overwrites nx-lang', () => {
  const mw = read('middleware.js');
  assert.match(mw, /x-vercel-ip-country/);
  assert.match(mw, /nx-geo-country/);
  assert.match(mw, /nx-lang=/);
  assert.doesNotMatch(mw, /navigator\.language/);
});
