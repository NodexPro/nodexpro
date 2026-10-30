/**
 * Core create → authorized /clients/:id card. Source + pure helpers. No network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalCreatedClientId,
  clientCardPath,
  createdClientDestination,
} from '../src/pages/client-create-navigation.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

test('create command navigates with the canonical returned client id', () => {
  const clientsSrc = readFileSync(join(dir, '../src/pages/Clients.tsx'), 'utf8');
  assert.match(clientsSrc, /canonicalCreatedClientId/);
  assert.match(clientsSrc, /createdClientDestination/);
  assert.match(clientsSrc, /openClientId/);
  assert.match(clientsSrc, /orgClients\(orgId\)/);
  assert.match(clientsSrc, /method:\s*'POST'/);
  assert.doesNotMatch(clientsSrc, /setTimeout|sleep\(/);
  assert.equal(canonicalCreatedClientId({ id: '  abc-123  ' }), 'abc-123');
  assert.equal(canonicalCreatedClientId({ id: '' }), null);
  assert.equal(canonicalCreatedClientId({}), null);
  assert.equal(canonicalCreatedClientId(null), null);
  assert.equal(clientCardPath('abc-123'), '/clients/abc-123');
});

test('create from /m/client-operations stays on the registry and opens the workspace modal', () => {
  assert.deepEqual(
    createdClientDestination({ currentPath: '/m/client-operations', clientId: 'abc-123' }),
    { kind: 'client_operations_modal', clientId: 'abc-123' },
  );
  assert.deepEqual(
    createdClientDestination({ currentPath: '/m/client-operations?q=x', clientId: 'abc-123' }),
    { kind: 'client_operations_modal', clientId: 'abc-123' },
  );
  assert.deepEqual(
    createdClientDestination({ currentPath: '/clients', clientId: 'abc-123' }),
    { kind: 'core_card', path: '/clients/abc-123' },
  );
  const registrySrc = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const pageSrc = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(pageSrc, /canCreateCoreClient=\{allowedActions\.includes\('create_core_client'\)\}/);
  assert.match(pageSrc, /pendingOpenClientId/);
  assert.match(pageSrc, /bypassCache/);
  assert.match(registrySrc, /orgClients\(orgId\)/);
  assert.match(registrySrc, /buildCreateClientCommandPayload\(draft\)/);
  assert.match(registrySrc, /setModalOpen\(true\)/);
  assert.match(registrySrc, /moduleClientOperationsCase\(clientId\)/);
  assert.match(registrySrc, /userFacingApiMessage/);
  assert.match(registrySrc, /pendingOpenClientId/);
  assert.match(registrySrc, /bypassCache/);
  assert.doesNotMatch(registrySrc, /navigate\(/);
  assert.doesNotMatch(registrySrc, /clientCardPath/);
  assert.doesNotMatch(registrySrc, /docflowClientTabAggregate/);
});

test('ClientCard loads orgClientFull and does not map every failure to not-found', () => {
  const cardSrc = readFileSync(join(dir, '../src/pages/ClientCard.tsx'), 'utf8');
  assert.match(cardSrc, /orgClientFull\(orgId, clientId\)/);
  assert.match(cardSrc, /if \(error && !client\) return/);
  assert.match(cardSrc, /clients\.errors\.notFound/);
  assert.doesNotMatch(cardSrc, /if \(!client\) return <p style=\{\{ padding: 24 \}\}>Client not found\.<\/p>/);
  const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as {
    clients: { errors: { notFound: string } };
  };
  const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as {
    clients: { errors: { notFound: string } };
  };
  assert.equal(en.clients.errors.notFound, 'Client not found.');
  assert.equal(he.clients.errors.notFound, 'הלקוח לא נמצא.');
});
