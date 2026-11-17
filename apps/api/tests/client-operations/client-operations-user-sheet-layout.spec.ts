import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND,
  CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND,
  parseClientOperationsSystemColumnWidthWrite,
  sanitizeClientOperationsHiddenColumnKeys,
  sanitizeClientOperationsSystemColumnWidths,
  userSheetLayoutStorageIdentity,
} from '../../src/domains/client-operations/client-operations-user-sheet-layout.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(dir, '../../../../supabase/migrations/219_client_operations_user_sheet_preferences.sql'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-user-sheet-layout.service.ts'),
  'utf8',
);
const commandSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const aggregateSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const auditSource = readFileSync(
  join(dir, '../../src/shared/audit-events.ts'),
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
const incrementalSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-incremental.pure.ts'),
  'utf8',
);
const routesSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.routes.ts'),
  'utf8',
);

const ELIGIBLE = new Set(['folder', 'client_name', 'vat', 'payroll', 'notes', 'user_slot_01']);
const SYSTEM = new Set(['folder', 'client_name', 'vat', 'payroll', 'notes']);

test('migration 219 is personal layout only; no localStorage import; no custom width_px rewrite', () => {
  assert.match(migration, /client_operations_user_sheet_preferences/);
  assert.match(migration, /primary key \(organization_id, user_id\)/);
  assert.doesNotMatch(migration, /operational_period_key/);
  assert.match(migration, /apply_client_operations_user_hidden_columns/);
  assert.match(migration, /apply_client_operations_user_system_column_width/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
  assert.doesNotMatch(migration, /client_operations_registry_custom_columns/);
  assert.doesNotMatch(migration, /218_/);
});

test('hidden keys drop mandatory identity columns and unknown keys; keep custom slots', () => {
  assert.deepEqual(
    sanitizeClientOperationsHiddenColumnKeys(['folder', 'client_name', 'vat', 'user_slot_01', 'ghost'], ELIGIBLE),
    ['vat', 'user_slot_01'],
  );
  assert.throws(() => sanitizeClientOperationsHiddenColumnKeys('vat', ELIGIBLE));
});

test('system widths clamp and ignore custom column keys', () => {
  assert.deepEqual(
    sanitizeClientOperationsSystemColumnWidths(
      { vat: 12, payroll: 999, user_slot_01: 200, notes: 160 },
      SYSTEM,
    ),
    { vat: 48, payroll: 480, notes: 160 },
  );
  assert.throws(() =>
    parseClientOperationsSystemColumnWidthWrite({
      columnKey: 'user_slot_01',
      widthPx: 160,
      systemColumnKeys: SYSTEM,
    }),
  );
  assert.deepEqual(
    parseClientOperationsSystemColumnWidthWrite({
      columnKey: 'vat',
      widthPx: 180,
      systemColumnKeys: SYSTEM,
    }),
    { column_key: 'vat', width_px: 180 },
  );
});

test('users and organizations are independent; layout is not period-scoped', () => {
  assert.notEqual(
    userSheetLayoutStorageIdentity({ organizationId: 'org-a', userId: 'user-a' }),
    userSheetLayoutStorageIdentity({ organizationId: 'org-a', userId: 'user-b' }),
  );
  assert.notEqual(
    userSheetLayoutStorageIdentity({ organizationId: 'org-a', userId: 'user-a' }),
    userSheetLayoutStorageIdentity({ organizationId: 'org-b', userId: 'user-a' }),
  );
  assert.doesNotMatch(serviceSource, /operationalPeriodKey|operational_period_key/);
});

test('named commands, GET attach, view RBAC, audit, no generic PATCH, no N+1', () => {
  assert.equal(CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND, 'set_client_operations_user_hidden_columns');
  assert.equal(
    CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND,
    'set_client_operations_user_system_column_width',
  );
  assert.match(commandSource, /CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND/);
  assert.match(commandSource, /CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND/);
  assert.match(commandSource, /assertRegistryView\(ctx\)/);
  assert.match(serviceSource, /AUDIT_ACTIONS\.CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_SET/);
  assert.match(serviceSource, /AUDIT_ACTIONS\.CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_SET/);
  assert.match(auditSource, /CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_SET/);
  assert.match(auditSource, /CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_SET/);
  assert.match(aggregateSource, /user_hidden_column_keys/);
  assert.match(aggregateSource, /user_system_column_widths/);
  assert.match(aggregateSource, /loadClientOperationsUserSheetLayoutForUser/);
  assert.equal((serviceSource.match(/apply_client_operations_user_hidden_columns/g) ?? []).length, 1);
  assert.equal((serviceSource.match(/apply_client_operations_user_system_column_width/g) ?? []).length, 1);
  assert.doesNotMatch(incrementalSource, /set_client_operations_user_hidden_columns/);
  assert.doesNotMatch(incrementalSource, /set_client_operations_user_system_column_width/);
  assert.match(commandSource, /set_client_operations_custom_column_width/);
  assert.match(routesSource, /withRegistryCommand/);
  assert.match(routesSource, /router\.post\('\/registry\/commands', \.\.\.withRegistryCommand/);
  assert.match(commandSource, /PERSONAL_SHEET_LAYOUT_COMMANDS\.has\(command\)/);
});

test('frontend hydrates layout from aggregate and does not write localStorage', () => {
  assert.match(pageSource, /user_hidden_column_keys/);
  assert.match(pageSource, /user_system_column_widths/);
  assert.match(viewSource, /CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND/);
  assert.match(viewSource, /CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND/);
  assert.doesNotMatch(viewSource, /loadClientOperationsHiddenColumns\(/);
  assert.doesNotMatch(viewSource, /saveClientOperationsHiddenColumns\(/);
  assert.doesNotMatch(viewSource, /loadClientOperationsColumnWidths\(/);
  assert.doesNotMatch(viewSource, /saveClientOperationsColumnWidths\(/);
  assert.match(viewSource, /persistCustomColumnWidth/);
});
