/**
 * Owner Languages & Translations is the platform translation center.
 * Source-contract checks: full catalog, filters/status, overlay, snapshot rollback.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'src/pages/PlatformOwnerLanguagesPage.tsx'), 'utf8');
const provider = readFileSync(join(root, 'src/i18n/I18nProvider.tsx'), 'utf8');
const catalog = readFileSync(
  join(root, '../api/src/domains/platform-localization/canonical-catalog.ts'),
  'utf8',
);
const bundled = readFileSync(
  join(root, '../api/src/domains/platform-localization/bundled-ui-catalog.ts'),
  'utf8',
);
const service = readFileSync(
  join(root, '../api/src/domains/platform-localization/platform-localization.service.ts'),
  'utf8',
);
const migration = readFileSync(
  join(root, '../../supabase/migrations/207_platform_language_version_snapshots.sql'),
  'utf8',
);

test('Owner catalog registers bundled UI keys, not a 48-key subset', () => {
  assert.match(catalog, /BUNDLED_UI_SOURCE_EN/);
  assert.match(bundled, /"clientOperations\.moduleTitle"/);
  assert.match(bundled, /"nav\.dashboard"/);
  const keyCount = (bundled.match(/^\s+"[^"]+":/gm) ?? []).length;
  assert.ok(keyCount > 200, `expected hundreds of bundled keys, got ${keyCount}`);
});

test('Owner catalog includes formerly missing Client Operations system labels in EN and HE', () => {
  assert.match(bundled, /"clientOperations\.registry\.columns\.clientName": "Client name"/);
  assert.match(bundled, /"clientOperations\.registry\.columns\.clientName": "שם לקוח"/);
  assert.match(bundled, /"clientOperations\.registry\.columns\.handler": "Case manager"/);
  assert.match(bundled, /"clientOperations\.registry\.columns\.handler": "מטפל בתיק"/);
  assert.match(bundled, /"clientOperations\.businessType\.osekPatur": "Exempt dealer"/);
  assert.match(bundled, /"clientOperations\.businessType\.osekPatur": "עוסק פטור"/);
  assert.match(bundled, /"clientOperations\.taxes\.cards\.vatRegistration": "VAT registration"/);
  assert.match(bundled, /"clientOperations\.taxes\.cards\.incomeTaxAdvances": "Income tax advances"/);
  assert.match(bundled, /"clientOperations\.fees\.tooltipWas": "Was: \{\{value\}\}"/);
  assert.match(bundled, /"clientOperations\.history\.summaries\.feeAgreementUpdated": "Fee agreement updated"/);
  assert.match(page, /Search key or source text/);
});

test('Owner Languages page shows module completeness, search, status filters and rollback', () => {
  assert.match(page, /module_completeness/);
  assert.match(page, /Filter by module/);
  assert.match(page, /Filter by status/);
  assert.match(page, /<option value="missing">Missing<\/option>/);
  assert.match(page, /<option value="draft">Draft<\/option>/);
  assert.match(page, /<option value="published">Published<\/option>/);
  assert.match(page, /rollback_platform_language/);
  assert.match(page, /dirtyEntries/);
  assert.doesNotMatch(page, /canonical settings\/account keys/);
  assert.match(page, /AI generation is not available/);
});

test('I18nProvider overlays published Owner catalog onto bundled JSON', () => {
  assert.match(provider, /public\/i18n\//);
  assert.match(provider, /overlay\[key\] \?\? lookup\(translations\[lang\], key\) \?\? lookup\(en, key\) \?\? key/);
  assert.match(provider, /import ru from '\.\/ru\.json'/);
});

test('draft save snapshots published text and publish writes a rollback snapshot', () => {
  assert.match(service, /capturePublishedSnapshotIfMissing/);
  assert.match(service, /rollback_platform_language/);
  assert.match(service, /published_snapshot_preserved: true/);
  assert.match(service, /existingRows/);
  assert.match(service, /isMissingSnapshotColumn/);
  assert.match(migration, /add column if not exists snapshot jsonb/);
  assert.match(service, /ai_translation: \{\s*available: false/);
});
