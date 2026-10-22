import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const billingSrc = readFileSync(join(dir, '../src/pages/Billing.tsx'), 'utf8');
const modulesSrc = readFileSync(join(dir, '../src/pages/Modules.tsx'), 'utf8');
const documentsSrc = readFileSync(join(dir, '../src/pages/Documents.tsx'), 'utf8');
const documentCardSrc = readFileSync(join(dir, '../src/pages/DocumentCard.tsx'), 'utf8');
const settingsSrc = readFileSync(join(dir, '../src/pages/Settings.tsx'), 'utf8');
const layoutSrc = readFileSync(join(dir, '../src/templates/template-1/TemplateLayout.tsx'), 'utf8');
const glassCss = readFileSync(join(dir, '../src/styles/nx-glass-surface.css'), 'utf8');
const dashSrc = readFileSync(join(dir, '../src/pages/Dashboard.tsx'), 'utf8');
const modalSrc = readFileSync(join(dir, '../src/components/glass/GlassModal.tsx'), 'utf8');
const enI18n = readFileSync(join(dir, '../src/i18n/en.json'), 'utf8');
const heI18n = readFileSync(join(dir, '../src/i18n/he.json'), 'utf8');

test('Billing reads one modules aggregate and never fabricates money or cards', () => {
  assert.match(billingSrc, /orgModulesState\(orgId\)/);
  assert.match(billingSrc, /subscribed_commercial_modules/);
  assert.doesNotMatch(billingSrc, /subscribedCommercialModules|matchingPlan/);
  assert.doesNotMatch(billingSrc, /orgSubscription\(/);
  assert.doesNotMatch(billingSrc, /staff-seat-entitlement/);
  assert.doesNotMatch(billingSrc, /priceAmount\s*\+|reduce\(|total\s*=/);
  assert.doesNotMatch(billingSrc, /stripe|paypal|cardNumber|cvv|cvc/i);
  assert.match(billingSrc, /billing\.totalUnavailable/);
  assert.match(billingSrc, /billing\.paymentMethod\.unavailable/);
  assert.match(billingSrc, /billing\.history\.unavailable/);
  assert.match(billingSrc, /disabled/);
});

test('Modules Select opens a glass modal and does not mock-pay via select-plan', () => {
  assert.match(modulesSrc, /setSelectedModuleId/);
  assert.match(modulesSrc, /GlassModal/);
  assert.match(modalSrc, /Escape/);
  assert.match(modalSrc, /createPortal/);
  assert.match(modulesSrc, /orgModuleActivate/);
  assert.match(modulesSrc, /orgModuleDeactivate/);
  assert.doesNotMatch(modulesSrc, /orgModuleSelectPlan/);
  assert.doesNotMatch(modulesSrc, /orgModuleChangePlan/);
  assert.match(modulesSrc, /checkoutUnavailable/);
});

test('Settings uses AppShell content width without a global sidebar change', () => {
  assert.match(settingsSrc, /nx-glass-page nx-glass-page--wide nx-settings/);
  assert.match(layoutSrc, /isSettings/);
  assert.match(layoutSrc, /isOfficeGlassSurface[\s\S]{0,40}\? 1600/);
  assert.match(glassCss, /\.nx-glass-page\.nx-settings/);
  assert.match(glassCss, /max-width: none/);
  assert.match(layoutSrc, /<AppSidebar/);
  assert.match(layoutSrc, /appearance=\{usesCanonicalWorkingShell \? 'co-navy-glass' : 'default'\}/);
});

test('Documents keep upload/archive contracts and only restyle the file picker', () => {
  assert.match(documentsSrc, /orgDocumentsUpload\(orgId\)/);
  assert.match(documentsSrc, /file_base64/);
  assert.match(documentsSrc, /GlassFilePicker/);
  assert.match(documentCardSrc, /\/archive'/);
  assert.match(documentCardSrc, /orgDocumentUpdateCommand/);
  assert.match(documentCardSrc, /method: 'POST'/);
  assert.match(documentCardSrc, /GlassFilePicker/);
});

test('Dashboard source is not restyled by this glass pass', () => {
  assert.match(dashSrc, /nx-dashboard\.css/);
  assert.doesNotMatch(dashSrc, /nx-glass-page--wide/);
});

test('EN/HE include billing, modules checkout and documents file-picker copy', () => {
  for (const src of [enI18n, heI18n]) {
    assert.match(src, /"totalUnavailable"/);
    assert.match(src, /"paymentMethod"/);
    assert.match(src, /"checkoutUnavailable"/);
    assert.match(src, /"chooseFile"/);
    assert.match(src, /"select"/);
    assert.match(src, /"close"/);
  }
});
