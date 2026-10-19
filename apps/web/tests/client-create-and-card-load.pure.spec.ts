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
} from '../src/pages/client-create-navigation.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

test('create command navigates with the canonical returned client id', () => {
  const clientsSrc = readFileSync(join(dir, '../src/pages/Clients.tsx'), 'utf8');
  assert.match(clientsSrc, /canonicalCreatedClientId/);
  assert.match(clientsSrc, /clientCardPath\(clientId\)/);
  assert.match(clientsSrc, /orgClients\(orgId\)/);
  assert.match(clientsSrc, /method:\s*'POST'/);
  assert.doesNotMatch(clientsSrc, /setTimeout|sleep\(/);
  assert.equal(canonicalCreatedClientId({ id: '  abc-123  ' }), 'abc-123');
  assert.equal(canonicalCreatedClientId({ id: '' }), null);
  assert.equal(canonicalCreatedClientId({}), null);
  assert.equal(canonicalCreatedClientId(null), null);
  assert.equal(clientCardPath('abc-123'), '/clients/abc-123');
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
