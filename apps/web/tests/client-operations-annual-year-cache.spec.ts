import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annualTabVersionFromCase,
  isAnnualVersionConflict,
  buildAnnualYearSnapshotKey,
  getAnnualYearSnapshot,
  invalidateAnnualYearSnapshotsForClient,
  putAnnualYearSnapshot,
  resolveDisplayedAnnualTaxYear,
  shouldApplyAnnualYearPersistResponse,
} from '../src/lib/client-operations-annual-year-cache.pure.ts';

test('year snapshots are keyed by organization, client, tax year and aggregate version', () => {
  const cache = new Map<string, { year: number }>();
  const keyInput = {
    organizationId: 'org-1',
    clientId: 'client-1',
    taxYear: 2025,
    aggregateVersion: 4,
  };
  putAnnualYearSnapshot(cache, keyInput, { year: 2025 });
  assert.equal(getAnnualYearSnapshot(cache, keyInput)?.year, 2025);
  assert.equal(
    getAnnualYearSnapshot(cache, { ...keyInput, aggregateVersion: 5 }),
    null,
  );
  assert.equal(buildAnnualYearSnapshotKey({ ...keyInput, organizationId: '' }), '');
});

test('selecting 2023 outside the last three keeps that year displayed', () => {
  assert.equal(
    resolveDisplayedAnnualTaxYear({
      selectedYear: 2023,
      workingTaxYear: 2026,
      boardYears: [2026, 2025, 2024],
      extraYears: [2023, 2022, 2021],
    }),
    2023,
  );
  assert.equal(
    resolveDisplayedAnnualTaxYear({
      selectedYear: null,
      workingTaxYear: 2023,
      boardYears: [2026, 2025, 2024],
      extraYears: [2023],
    }),
    2023,
  );
});

test('switching 2026 → 2024 → 2025 keeps the selected tab; a late 2024 persist does not win', () => {
  assert.equal(
    resolveDisplayedAnnualTaxYear({
      selectedYear: 2026,
      workingTaxYear: 2024,
      boardYears: [2026, 2025, 2024],
    }),
    2026,
  );
  assert.equal(
    resolveDisplayedAnnualTaxYear({
      selectedYear: 2024,
      workingTaxYear: 2026,
      boardYears: [2026, 2025, 2024],
    }),
    2024,
  );
  assert.equal(
    shouldApplyAnnualYearPersistResponse({
      selectedYear: 2026,
      persistedYear: 2024,
      pendingYear: 2026,
      persistGeneration: 1,
      responseGeneration: 1,
    }),
    true,
  );
  assert.equal(
    shouldApplyAnnualYearPersistResponse({
      selectedYear: 2026,
      persistedYear: 2024,
      persistGeneration: 2,
      responseGeneration: 1,
    }),
    false,
  );
  assert.equal(
    shouldApplyAnnualYearPersistResponse({
      selectedYear: 2026,
      persistedYear: 2026,
      pendingYear: null,
      persistGeneration: 2,
      responseGeneration: 2,
    }),
    true,
  );
});

test('superseded persist keeps expected version from the command without painting a stale year', () => {
  assert.equal(annualTabVersionFromCase({ annual_tab: { read_model_version: 9 } }), 9);
  assert.equal(annualTabVersionFromCase({ annual_tab: null }), null);
  assert.equal(
    annualTabVersionFromCase(
      { annual_tab: { read_model_version: 9 }, capital_declaration_tab: { read_model_version: 2 } },
      'capital_declaration',
    ),
    2,
  );
  assert.equal(isAnnualVersionConflict({ status: 409, code: 'CONFLICT' }), true);
  assert.equal(isAnnualVersionConflict({ status: 400, code: 'CONFLICT' }), false);
});

test('command refresh invalidates previous version snapshots for the same client', () => {
  const cache = new Map<string, { v: number }>();
  putAnnualYearSnapshot(
    cache,
    { organizationId: 'org-1', clientId: 'client-1', taxYear: 2026, aggregateVersion: 3 },
    { v: 3 },
  );
  putAnnualYearSnapshot(
    cache,
    { organizationId: 'org-1', clientId: 'client-2', taxYear: 2026, aggregateVersion: 3 },
    { v: 3 },
  );
  invalidateAnnualYearSnapshotsForClient(cache, { organizationId: 'org-1', clientId: 'client-1' });
  assert.equal(
    getAnnualYearSnapshot(cache, {
      organizationId: 'org-1',
      clientId: 'client-1',
      taxYear: 2026,
      aggregateVersion: 3,
    }),
    null,
  );
  assert.equal(
    getAnnualYearSnapshot(cache, {
      organizationId: 'org-1',
      clientId: 'client-2',
      taxYear: 2026,
      aggregateVersion: 3,
    })?.v,
    3,
  );
});
