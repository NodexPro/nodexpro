/**
 * Global module OFF (modules.is_active) must hide DocFlow floating launcher and
 * deny DocFlow entitlement surfaces — without deleting org entitlement rows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const floatingWidgetSource = readFileSync(
  join(dir, '../../src/domains/docflow/docflow-floating-widget.service.ts'),
  'utf8'
);
const docflowGuardsSource = readFileSync(join(dir, '../../src/domains/docflow/docflow.guards.ts'), 'utf8');
const entitlementSource = readFileSync(join(dir, '../../src/domains/modules/entitlement.service.ts'), 'utf8');
const requireModuleActiveSource = readFileSync(
  join(dir, '../../src/middleware/requireModuleActive.ts'),
  'utf8'
);
const appShellSource = readFileSync(join(dir, '../../../web/src/components/layout/AppShell.tsx'), 'utf8');
const floatingWidgetUiSource = readFileSync(
  join(dir, '../../../web/src/components/DocflowFloatingWidget.tsx'),
  'utf8'
);

test('floating widget aggregate selects modules.is_active and hides when globally inactive', () => {
  assert.match(floatingWidgetSource, /\.select\('id, is_active'\)/);
  assert.match(floatingWidgetSource, /!mod\?\.id \|\| !\(mod as \{ is_active\?: boolean \}\)\.is_active/);
  assert.match(floatingWidgetSource, /widget_visibility:\s*'hidden'/);
  assert.match(floatingWidgetSource, /Global kill-switch/);
});

test('assertDocflowEntitled denies when modules.is_active is false', () => {
  assert.match(docflowGuardsSource, /\.select\('id, is_active'\)/);
  assert.match(docflowGuardsSource, /!\(mod as \{ is_active\?: boolean \}\)\.is_active/);
  assert.match(docflowGuardsSource, /Module is globally disabled/);
});

test('session enabledModules filter respects modules.is_active (no DocFlow-only flag)', () => {
  assert.match(entitlementSource, /\.select\('id, is_active'\)/);
  assert.match(entitlementSource, /globallyActiveIds/);
  assert.match(entitlementSource, /if \(!globallyActiveIds\.has\(mod\.moduleId\)\) continue/);
});

test('requireModuleActive denies globally inactive modules', () => {
  assert.match(requireModuleActiveSource, /is_active/);
  assert.match(requireModuleActiveSource, /modules\.is_active=false|globally disabled|globally inactive/i);
});

test('floating widget UI has no private DocFlow global enable flag and reloads on session module change', () => {
  assert.doesNotMatch(floatingWidgetUiSource, /docflowGlobal|globalDocflow|is_docflow_globally/);
  assert.match(floatingWidgetUiSource, /widget_visibility/);
  assert.match(floatingWidgetUiSource, /visibility !== 'visible'/);
  assert.match(floatingWidgetUiSource, /enabledModulesKey/);
});

test('AppShell sidebar module links still gate on session enabledModules', () => {
  assert.match(appShellSource, /isEnabledModuleItem/);
  assert.match(appShellSource, /enabledModulesSet/);
  assert.match(appShellSource, /DocflowFloatingWidget/);
});

test('global OFF does not delete organization_modules / subscriptions (owner command note)', () => {
  const ownerModulesSource = readFileSync(
    join(dir, '../../src/domains/owner-modules/owner-modules.service.ts'),
    'utf8'
  );
  assert.match(ownerModulesSource, /Does not delete organization_modules/);
  assert.match(ownerModulesSource, /org activation\/entitlement rows are preserved/);
});
