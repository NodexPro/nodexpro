import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isModuleEntitlementDenied,
  localizeModuleBlockReason,
  localizeModuleCatalogName,
  localizeModulePlanName,
  moduleCatalogNameKey,
  moduleEntitlementErrorKey,
} from '../src/modules/module-catalog-copy.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as {
  nav: { clientOperations: string };
  clientOperations: { moduleTitle: string };
  modules: { limits: { included_staff_seats: string } };
};
const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as {
  nav: { clientOperations: string };
  clientOperations: { moduleTitle: string };
  modules: { limits: { included_staff_seats: string } };
};
const lookup = (dict: unknown) => (key: string) => {
  const parts = key.split('.');
  let value: unknown = dict;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return key;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : key;
};

test('Client Operations catalog display name is Client Management / ניהול לקוחות', () => {
  assert.equal(moduleCatalogNameKey('client-operations'), 'modules.catalogName.client-operations');
  assert.equal(localizeModuleCatalogName('client-operations', 'Client Operations', lookup(en)), 'Client Management');
  assert.equal(localizeModuleCatalogName('client-operations', 'Client Operations', lookup(he)), 'ניהול לקוחות');
  assert.equal(en.nav.clientOperations, 'Client Management');
  assert.equal(he.nav.clientOperations, 'ניהול לקוחות');
  assert.equal(en.clientOperations.moduleTitle, 'Client Management');
  assert.equal(he.clientOperations.moduleTitle, 'ניהול לקוחות');
});

test('catalog plan names and entitlement copy follow locale without changing prices', () => {
  assert.equal(localizeModulePlanName('standard', 'Standard', lookup(en)), 'Standard');
  assert.equal(localizeModulePlanName('standard', 'Standard', lookup(he)), 'סטנדרט');
  assert.equal(
    localizeModuleBlockReason('No subscription or trial for this module', lookup(en)),
    'No subscription or trial for this module',
  );
  assert.equal(
    localizeModuleBlockReason('No subscription or trial for this module', lookup(he)),
    'אין מנוי או תקופת ניסיון למודול זה',
  );
  assert.match(en.modules.limits.included_staff_seats, /included staff seats/);
  assert.match(he.modules.limits.included_staff_seats, /מקומות עובדים כלולים/);
});

test('entitlement 403 maps to catalog copy and a catalog path, not raw English', () => {
  assert.equal(isModuleEntitlementDenied({ code: 'MODULE_NOT_ACTIVE', status: 403 }), true);
  assert.equal(
    moduleEntitlementErrorKey({ code: 'MODULE_NOT_ACTIVE' }),
    'clientOperations.errors.moduleNotActive',
  );
  assert.equal(
    lookup(he)('clientOperations.errors.moduleNotActive'),
    'המודול אינו פעיל בארגון זה. פתחו את קטלוג המודולים כדי לבדוק מסלולים והפעלה.',
  );
  const modulesPage = readFileSync(join(dir, '../src/pages/Modules.tsx'), 'utf8');
  assert.match(modulesPage, /localizeModuleCatalogName/);
  assert.match(modulesPage, /localizeModuleBlockReason/);
  assert.doesNotMatch(modulesPage, /\{m\.name\}/);
  const registry = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(registry, /navigate\('\/modules'\)/);
  assert.match(registry, /clientOperations\.openModuleCatalog/);
});
