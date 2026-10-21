/**
 * Documents Deep Ocean controls + Modules commercial showcase.
 * Presentation only: existing document and module commands stay unchanged.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  moduleShowcaseBenefitKeys,
  resolveModuleShowcase,
} from '../src/modules/module-showcase-copy.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const en = JSON.parse(read('../src/i18n/en.json')) as Record<string, unknown>;
const he = JSON.parse(read('../src/i18n/he.json')) as Record<string, unknown>;

function flatten(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
}

test('1. sidebar no longer renders a language selector', () => {
  const sidebar = read('../src/templates/template-1/components/SidebarAccountBlock.tsx');
  assert.doesNotMatch(sidebar, /UiLanguageSwitch/);
  assert.doesNotMatch(sidebar, /t1-sidebar-lang/);
  assert.doesNotMatch(sidebar, /showLanguage/);
  assert.match(sidebar, /organization_switcher/);
  assert.match(sidebar, /logout_action/);
});

test('2. Dashboard EN/עב switcher still writes the language command', () => {
  const dash = read('../src/pages/Dashboard.tsx');
  const switcher = read('../src/components/glass/UiLanguageSwitch.tsx');
  assert.match(dash, /<UiLanguageSwitch compact \/>/);
  assert.match(switcher, /auth\.setUiLanguage\(code\)/);
  assert.match(switcher, /AUTH\.setUiLanguageCommand|setUiLanguage/);
});

test('3. Documents and Modules follow the shared office language', () => {
  const documents = read('../src/pages/Documents.tsx');
  const modules = read('../src/pages/Modules.tsx');
  assert.match(documents, /const \{ t, lang \} = useI18n\(\)/);
  assert.match(documents, /dir=\{dir\} lang=\{lang\}/);
  assert.match(modules, /const \{ t, lang \} = useI18n\(\)/);
  assert.match(modules, /dir=\{dir\} lang=\{lang\}/);
});

test('4-6. Documents Deep Ocean controls keep upload and type filter contracts', () => {
  const documents = read('../src/pages/Documents.tsx');
  const css = read('../src/styles/nx-documents.css');
  assert.match(documents, /nx-documents--deep-ocean/);
  assert.match(documents, /orgDocumentsUpload\(orgId\)/);
  assert.match(documents, /documentType/);
  assert.match(documents, /includeArchived/);
  assert.match(documents, /t\('documents\.allTypes'\)/);
  assert.doesNotMatch(documents, /method: 'PATCH'/);
  assert.match(css, /\.nx-documents--deep-ocean \.nx-glass-btn--purple/);
  assert.match(css, /\.nx-documents--deep-ocean \.nx-glass-toolbar \.nx-glass-input/);
});

test('7-10. Modules cards are two-column, hide technical internals, and restyle the banner', () => {
  const modules = read('../src/pages/Modules.tsx');
  const css = read('../src/styles/nx-modules-showcase.css');
  assert.match(modules, /nx-modules-card/);
  assert.match(modules, /nx-modules-card__commerce/);
  assert.match(modules, /nx-modules-card__why/);
  assert.match(modules, /commercialModules\(/);
  assert.match(modules, /data-testid="nx-modules-card"/);
  assert.doesNotMatch(modules, /nx-glass-code/);
  assert.doesNotMatch(modules, /modules\.descriptionUnavailable/);
  assert.doesNotMatch(modules, /modules\.version/);
  assert.doesNotMatch(modules, /modules\.scope/);
  assert.match(modules, /nx-modules-banner/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 45%\) minmax\(0, 55%\)/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.doesNotMatch(css, /rgba\(146,\s*64,\s*14/);
});

test('11-14. Module actions stay entitlement-gated and checkout cannot activate paid modules', () => {
  const modules = read('../src/pages/Modules.tsx');
  assert.match(modules, /m\.canActivate/);
  assert.match(modules, /m\.canDeactivate/);
  assert.match(modules, /orgModuleActivate/);
  assert.match(modules, /orgModuleDeactivate/);
  assert.match(modules, /checkoutUnavailable/);
  assert.match(modules, /checkoutUnavailableAction/);
  assert.doesNotMatch(modules, /orgModuleSelectPlan/);
  assert.doesNotMatch(modules, /orgModuleChangePlan/);
  assert.doesNotMatch(modules, /method: 'PATCH'/);
});

test('15. marketing benefits are keyed by authorized module codes only', () => {
  assert.equal(resolveModuleShowcase('client-operations').catalog, 'clientOperations');
  assert.equal(resolveModuleShowcase('docflow').catalog, 'docflow');
  assert.equal(resolveModuleShowcase('invoice').catalog, 'invoice');
  assert.equal(resolveModuleShowcase('unknown-module').catalog, 'fallback');
  assert.equal(moduleShowcaseBenefitKeys('client-operations').length, 6);
  assert.equal(moduleShowcaseBenefitKeys('missing').length, 3);
  const modules = read('../src/pages/Modules.tsx');
  assert.match(modules, /moduleShowcaseBenefitKeys\(m\.code\)/);
  assert.doesNotMatch(modules, /fake-module|invented/);
});

test('16. EN/HE showcase and trial copy keys match', () => {
  const enKeys = flatten((en as { modules: unknown }).modules).sort();
  const heKeys = flatten((he as { modules: unknown }).modules).sort();
  assert.deepEqual(heKeys, enKeys);
  for (const required of [
    'trialEndedHint',
    'showcase.clientOperations.lead',
    'showcase.clientOperations.benefits.6',
    'showcase.docflow.headline',
    'showcase.invoice.closing',
    'showcase.fallback.benefits.3',
    'checkoutUnavailable',
  ]) {
    assert.ok(enKeys.includes(required), `missing EN modules.${required}`);
    assert.ok(heKeys.includes(required), `missing HE modules.${required}`);
  }
});

test('17. Dashboard, Clients, Settings, Users & Roles keep their existing screen classes', () => {
  assert.match(read('../src/pages/Dashboard.tsx'), /nx-dashboard/);
  assert.match(read('../src/pages/Clients.tsx'), /nx-clients--deep-ocean/);
  assert.match(read('../src/pages/Settings.tsx'), /nx-settings-deep-ocean/);
  assert.match(read('../src/pages/UsersRoles.tsx'), /nx-ur-page/);
  assert.doesNotMatch(read('../src/pages/Dashboard.tsx'), /nx-modules--deep-ocean/);
  assert.doesNotMatch(read('../src/pages/Clients.tsx'), /nx-modules-card/);
});
