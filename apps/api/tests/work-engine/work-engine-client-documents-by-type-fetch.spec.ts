import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const workEngineApiSource = readFileSync(
  join(dir, '../../../web/src/api/work-engine.ts'),
  'utf8',
);
const modalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx'),
  'utf8',
);
const tabHostSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);

test('by-type aggregate fetch dedupes in-flight requests by client/type/year key', () => {
  assert.ok(workEngineApiSource.includes('inFlightInvoicesClientDocumentsByTypeFetches'));
  assert.ok(workEngineApiSource.includes('invoicesClientDocumentsByTypeFetchKey'));
  assert.ok(workEngineApiSource.includes('cancelWorkEngineInvoicesClientDocumentsByTypeAggregateFetch'));
  assert.ok(workEngineApiSource.includes('{ signal: controller.signal }'));
});

test('by-type modal aborts stale fetch on close/key change and ignores unstable callbacks', () => {
  assert.ok(modalSource.includes('onBusyChangeRef'));
  assert.ok(modalSource.includes('onErrorRef'));
  assert.ok(modalSource.includes('cancelWorkEngineInvoicesClientDocumentsByTypeAggregateFetch'));
  assert.ok(!modalSource.includes('[loadAggregate, open, params]'));
  assert.ok(!modalSource.includes('[onBusyChange, onError, params]'));
});

test('documents modal table is Excel-like, RTL, no horizontal scroll at desktop width', () => {
  const css = readFileSync(
    join(dir, '../../../web/src/styles/nx-work-engine-client-documents.css'),
    'utf8',
  );
  assert.match(css, /\.nx-we-documents-modal\.nx-income-wizard\s*\{[^}]*width:\s*min\(1360px/);
  assert.match(css, /\.nx-we-documents-modal__table-wrap\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(css, /\.nx-we-documents-modal__table\s*\{[^}]*table-layout:\s*fixed/);
  assert.match(css, /\.nx-we-documents-modal__table th\s*\{[^}]*text-align:\s*center/);
  assert.match(css, /\.nx-we-documents-modal__table td\s*\{[^}]*text-align:\s*right/);
  assert.doesNotMatch(css, /min-width:\s*720px/);
});

test('invoices tab host no longer passes inline onError into documents shell', () => {
  assert.ok(tabHostSource.includes('onError={handlePanelError}'));
  assert.ok(!tabHostSource.includes('onError={(message) => setError(message)}'));
});
