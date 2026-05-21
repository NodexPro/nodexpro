import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const clientsTabSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-clients-tab.read-model.service.ts'),
  'utf8',
);
const tabHostSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);
const registryPageSource = readFileSync(
  join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'),
  'utf8',
);

test('clients tab aggregate reuses Client Operations registry read model', () => {
  assert.match(clientsTabSource, /listClientOperationsRegistry/);
  assert.match(clientsTabSource, /listOperationalNoteTypes/);
  assert.equal(clientsTabSource.includes('work_engine_clients_tab_aggregate'), true);
  assert.doesNotMatch(clientsTabSource, /\.from\(['"]clients['"]\).*insert/i);
});

test('tab host fetches clients-tab and renders registry view', () => {
  assert.match(tabHostSource, /fetchWorkEngineClientsTabAggregate/);
  assert.match(tabHostSource, /ClientOperationsRegistryView/);
  assert.match(tabHostSource, /tabKey === 'clients'/);
  assert.doesNotMatch(tabHostSource, /\/m\/client-operations/);
});

test('standalone Client Operations page still uses registry module route', () => {
  assert.match(registryPageSource, /moduleClientOperationsRegistry/);
  assert.match(registryPageSource, /ClientOperationsRegistryView/);
});
