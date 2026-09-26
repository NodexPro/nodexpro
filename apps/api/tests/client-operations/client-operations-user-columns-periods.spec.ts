/**
 * User Excel columns × operational periods — contract + pure tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatUserCustomCellDisplayHe,
  isMeaningfulTypedValue,
  latestEarlierPeriodKey,
  mapEligibleColumnsForPeriodSetupDialog,
  shouldPrecheckAutoExtend,
} from '../../src/domains/client-operations/client-operations-user-columns-periods.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(dir, '../../../../supabase/migrations/177_client_operations_user_columns_periods.sql'),
  'utf8',
);
const commandService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const registryService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const periodsService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-user-columns-periods.service.ts'),
  'utf8',
);
const viewSource = readFileSync(
  join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const pageSource = readFileSync(
  join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'),
  'utf8',
);

test('1 — blank custom cell renders no dash', () => {
  assert.equal(formatUserCustomCellDisplayHe('text', null), '');
  assert.equal(formatUserCustomCellDisplayHe('text', { value_text: '  ', value_number: null, value_date: null, value_bool: null }), '');
  assert.equal(formatUserCustomCellDisplayHe('text', { value_text: 'הערה', value_number: null, value_date: null, value_bool: null }), 'הערה');
  assert.match(viewSource, /is-blank/);
  assert.doesNotMatch(viewSource, /setCellDraft\(current === '—' \? '' : current\)/);
});

test('2/3/4/5 — autosave debounce + blur/Enter/period flush', () => {
  assert.match(viewSource, /500/);
  assert.match(viewSource, /scheduleCustomCellAutosave/);
  assert.match(viewSource, /flushCustomCellKey/);
  assert.match(viewSource, /flushDirtyBeforePeriodChange/);
  assert.match(viewSource, /tryStartCustomCellSave/);
  assert.match(viewSource, /rememberCustomCellDraft/);
  assert.match(viewSource, /onBlur=\{\(\) => void commitCustomCellEdit/);
  assert.match(viewSource, /event\.key === 'Enter'/);
});

test('6 — stale save response protection', () => {
  // Parent no longer blind-applies cell-save aggregates; View gates by period + draft.
  assert.match(viewSource, /applyAggregate:\s*false/);
  assert.match(viewSource, /shouldApplyCellSaveAggregate/);
  assert.match(viewSource, /preserveEditorDraftIfNeeded/);
  assert.match(pageSource, /options\?\.applyAggregate !== false/);
  assert.doesNotMatch(viewSource, /customCellSaveSeqRef/);
});

test('7-12 — period values + carry-forward + non-destructive hide', () => {
  assert.match(periodsService, /carryForwardColumnIntoPeriod/);
  assert.match(periodsService, /client_operations_registry_custom_column_period_values/);
  assert.match(periodsService, /toRemove/);
  assert.match(periodsService, /\.delete\(/);
  assert.doesNotMatch(periodsService, /period_values[\s\S]{0,80}\.delete\(/);
  assert.equal(latestEarlierPeriodKey('2026-11', ['2026-09', '2026-10', '2026-12']), '2026-10');
});

test('13-17 — new-period eligibility + precheck + הכל', () => {
  const eligible = mapEligibleColumnsForPeriodSetupDialog({
    operational_period_key: '2027-01',
    eligible: [
      {
        id: '1',
        key: 'note',
        label: 'הערה',
        auto_extend_to_future: true,
        auto_extend_from_period_key: '2026-09',
      },
      {
        id: '2',
        key: 'track',
        label: 'מעקב',
        auto_extend_to_future: false,
        auto_extend_from_period_key: null,
      },
    ],
  });
  assert.equal(eligible[0]!.preselected, true);
  assert.equal(eligible[1]!.preselected, false);
  assert.match(viewSource, /הכל/);
  assert.match(viewSource, /initialize_client_operations_user_columns_for_period/);
  assert.match(periodsService, /isBlankCustomColumnLabel/);
});

test('18 — GET does not initialize period setup', () => {
  assert.doesNotMatch(registryService, /client_operations_user_columns_period_setup[\s\S]{0,120}upsert/);
  assert.match(registryService, /buildUserColumnsPeriodAggregateExtras/);
  assert.match(pageSource, /initialize_client_operations_user_columns_for_period/);
  assert.match(pageSource, /periodSetupEmptyRef/);
});

test('19 — initialization command idempotent marker upsert', () => {
  assert.match(periodsService, /initializeUserColumnsForPeriod/);
  assert.match(periodsService, /onConflict: 'organization_id,operational_period_key'/);
});

test('20 — viewer cannot initialize/edit', () => {
  assert.match(commandService, /assertEdit\(ctx\)/);
  assert.match(pageSource, /if \(!canEdit\) return/);
  assert.match(viewSource, /canEdit && column\.settings_available/);
});

test('21-24 — CASE B legacy baseline', () => {
  assert.match(migration, /legacy_baseline_period_key/);
  assert.match(migration, /legacy_baseline_completed_at/);
  assert.doesNotMatch(migration, /insert into public\.client_operations_registry_custom_column_period_values/);
  assert.match(periodsService, /applyLegacyBaselineTransition/);
  assert.match(periodsService, /isMeaningfulTypedValue/);
  assert.match(viewSource, /תקופת התחלה למידע הקיים/);
});

test('25-29 — max 10, gear only user, rename/resize retained', () => {
  assert.match(commandService, /CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX/);
  assert.match(viewSource, /nx-co-sheet__col-gear/);
  assert.match(viewSource, /cell_kind === 'custom'/);
  assert.match(viewSource, /beginResize/);
  assert.match(viewSource, /rename_client_operations_custom_column/);
  assert.match(commandService, /set_client_operations_custom_column_period_settings/);
  assert.match(commandService, /operationalPeriodKeyFrom\(body\.operational_period_key\)/);
});

test('migration 177 schema present; no 172-176 reapply', () => {
  assert.match(migration, /client_operations_registry_custom_column_period_visibility/);
  assert.match(migration, /client_operations_registry_custom_column_period_values/);
  assert.match(migration, /client_operations_user_columns_period_setup/);
  assert.doesNotMatch(migration, /172_|173_|174_|175_|176_/);
});

test('meaningful typed value helper', () => {
  assert.equal(isMeaningfulTypedValue({ value_text: null, value_number: null, value_date: null, value_bool: null }), false);
  assert.equal(isMeaningfulTypedValue({ value_text: 'x', value_number: null, value_date: null, value_bool: null }), true);
  assert.equal(shouldPrecheckAutoExtend({
    auto_extend_to_future: true,
    auto_extend_from_period_key: '2026-09',
    operational_period_key: '2026-08',
  }), false);
});
