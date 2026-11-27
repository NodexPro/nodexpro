import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgnorableClientOperationsRegistryLoadFailure } from '../src/lib/client-operations-registry-load-error.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('abort and stale workspace are not registry open failures', () => {
  assert.equal(
    isIgnorableClientOperationsRegistryLoadFailure({
      error: { name: 'AbortError' },
    }),
    true,
  );
  assert.equal(
    isIgnorableClientOperationsRegistryLoadFailure({
      error: new Error('network'),
      signalAborted: true,
    }),
    true,
  );
  assert.equal(
    isIgnorableClientOperationsRegistryLoadFailure({
      error: { name: 'StaleWorkspaceError' },
    }),
    true,
  );
  assert.equal(
    isIgnorableClientOperationsRegistryLoadFailure({
      error: new Error('boom'),
    }),
    false,
  );
});

test('quiet refresh after cache paint does not overlay a false load error', () => {
  assert.equal(
    isIgnorableClientOperationsRegistryLoadFailure({
      error: new Error('failed'),
      quiet: true,
      paintedFromCache: true,
    }),
    true,
  );
  assert.equal(
    isIgnorableClientOperationsRegistryLoadFailure({
      error: new Error('failed'),
      quiet: true,
      paintedFromCache: false,
    }),
    false,
  );
});

test('registry apply success clears error; identity reload and abort ignore are wired', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const boundary = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRouteErrorBoundary.tsx'),
    'utf8',
  );
  assert.match(page, /isIgnorableClientOperationsRegistryLoadFailure/);
  assert.match(page, /setError\(''\)/);
  assert.match(page, /paintedFromCache/);
  assert.match(page, /identityEpoch, activeOrganizationId/);
  assert.match(page, /loadSeqRef\.current \+= 1/);
  assert.match(view, /if \(!reportingDashboard\?\.kpi_cards\) return null/);
  assert.match(view, /reportingDashboard\.kpi_cards\.map/);
  assert.match(view, /if \(!previous\) return null/);
  assert.match(view, /column\.label \?\? ''/);
  assert.match(boundary, /identityEpoch/);
  assert.match(boundary, /location\.key/);
});
