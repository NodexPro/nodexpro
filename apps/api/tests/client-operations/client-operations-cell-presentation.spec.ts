import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_CELL_PRESENTATION_BULK_MAX,
  CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND,
  clientOperationsCellPresentationStorageIdentity,
  clientOperationsPresentationMapKey,
  parseClientOperationsCellPresentationWrites,
  parseClientOperationsPresentationMapKey,
  resolveClientOperationsPresentationRowIdentity,
  sanitizeClientOperationsCellPresentation,
  toClientOperationsUserCellFormattingMap,
} from '../../src/domains/client-operations/client-operations-cell-presentation.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(dir, '../../../../supabase/migrations/218_client_operations_cell_presentations.sql'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-cell-presentation.service.ts'),
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
const incrementalSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-incremental.pure.ts'),
  'utf8',
);
const auditSource = readFileSync(
  join(dir, '../../src/shared/audit-events.ts'),
  'utf8',
);
const pageSource = readFileSync(
  join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'),
  'utf8',
);
const viewSource = readFileSync(
  join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

test('migration 218 is schema + atomic RPC only; no localStorage import', () => {
  assert.match(migration, /client_operations_cell_presentations/);
  assert.match(migration, /apply_client_operations_cell_presentations/);
  assert.match(migration, /primary key \(organization_id, user_id, operational_period_key, row_kind, row_id, column_key\)/);
  assert.match(migration, /row_kind in \('client', 'manual'\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
  assert.match(migration, /Does NOT import/);
  assert.doesNotMatch(migration, /217_/);
});

test('one cell save uses stable client uuid + column key, never a row index', () => {
  const parsed = parseClientOperationsCellPresentationWrites([
    {
      row_kind: 'client',
      row_id: CLIENT_A,
      column_key: 'vat',
      presentation: { fill: '#9D4EDD', fontSize: 16, bold: true },
    },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.row_id, CLIENT_A);
  assert.equal(parsed[0]?.column_key, 'vat');
  assert.equal(parsed[0]?.presentation?.fill, '#9d4edd');
  assert.equal(parsed[0]?.presentation?.fontSize, 16);
  assert.equal(parsed[0]?.presentation?.bold, true);
  assert.throws(() =>
    parseClientOperationsCellPresentationWrites([
      { row_kind: 'client', row_id: '0', column_key: 'vat', presentation: { bold: true } },
    ]),
  );
  assert.throws(() =>
    parseClientOperationsCellPresentationWrites([
      { row_kind: 'client', row_id: 'Acme Ltd', column_key: 'vat', presentation: { bold: true } },
    ]),
  );
});

test('range bulk is one atomic payload; last write per identity wins; no N+1 shape', () => {
  const parsed = parseClientOperationsCellPresentationWrites([
    { row_kind: 'client', row_id: CLIENT_A, column_key: 'vat', presentation: { italic: true } },
    { row_kind: 'client', row_id: CLIENT_B, column_key: 'notes', presentation: { underline: true } },
    { row_kind: 'manual', row_id: 'manual:01', column_key: 'user_slot_01', presentation: { align: 'center' } },
    { row_kind: 'client', row_id: CLIENT_A, column_key: 'vat', presentation: { italic: true, fill: '#ffffff' } },
  ]);
  assert.equal(parsed.length, 3);
  const vat = parsed.find((cell) => cell.row_id === CLIENT_A && cell.column_key === 'vat');
  assert.equal(vat?.presentation?.fill, '#ffffff');
  assert.equal(vat?.presentation?.italic, true);
  assert.match(serviceSource, /supabaseAdmin\.rpc\('apply_client_operations_cell_presentations'/);
  assert.equal((serviceSource.match(/apply_client_operations_cell_presentations/g) ?? []).length, 1);
  assert.doesNotMatch(serviceSource, /\.upsert\(/);
  assert.match(viewSource, /command: CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND/);
  const persistStart = viewSource.indexOf('const persistCellPresentation =');
  const persistSlice = viewSource.slice(persistStart, persistStart + 1800);
  assert.match(persistSlice, /onRegistryCommand\(/);
  assert.equal((persistSlice.match(/onRegistryCommand\(/g) ?? []).length, 1);
  assert.doesNotMatch(persistSlice, /for \(const key of targets\)[\s\S]*onRegistryCommand/);
});

test('periods, users and organizations are independent identities', () => {
  const oct = clientOperationsCellPresentationStorageIdentity({
    organizationId: 'org-a',
    userId: 'user-a',
    operationalPeriodKey: '2026-10',
    rowKind: 'client',
    rowId: CLIENT_A,
    columnKey: 'vat',
  });
  const sep = clientOperationsCellPresentationStorageIdentity({
    organizationId: 'org-a',
    userId: 'user-a',
    operationalPeriodKey: '2026-09',
    rowKind: 'client',
    rowId: CLIENT_A,
    columnKey: 'vat',
  });
  const otherUser = clientOperationsCellPresentationStorageIdentity({
    organizationId: 'org-a',
    userId: 'user-b',
    operationalPeriodKey: '2026-10',
    rowKind: 'client',
    rowId: CLIENT_A,
    columnKey: 'vat',
  });
  const otherOrg = clientOperationsCellPresentationStorageIdentity({
    organizationId: 'org-b',
    userId: 'user-a',
    operationalPeriodKey: '2026-10',
    rowKind: 'client',
    rowId: CLIENT_A,
    columnKey: 'vat',
  });
  assert.notEqual(oct, sep);
  assert.notEqual(oct, otherUser);
  assert.notEqual(oct, otherOrg);
  const store = new Map<string, { fill?: string }>();
  store.set(oct, { fill: '#ff0000' });
  assert.equal(store.get(sep), undefined);
  assert.equal(store.get(otherUser), undefined);
  assert.equal(store.get(otherOrg), undefined);
});

test('reload map uses stable row/column ids including custom columns and manual rows', () => {
  const map = toClientOperationsUserCellFormattingMap([
    {
      row_kind: 'client',
      row_id: CLIENT_A,
      column_key: 'user_slot_01',
      presentation: { wrap: true, numberFormat: 'currency' },
    },
    {
      row_kind: 'manual',
      row_id: 'manual:03',
      column_key: 'notes',
      presentation: { fontSize: 18 },
    },
    {
      row_kind: 'client',
      row_id: 'row-index-4',
      column_key: 'vat',
      presentation: { bold: true },
    },
  ]);
  assert.deepEqual(map[clientOperationsPresentationMapKey(CLIENT_A, 'user_slot_01')], {
    wrap: true,
    numberFormat: 'currency',
  });
  assert.equal(map[clientOperationsPresentationMapKey('manual:03', 'notes')]?.fontSize, 18);
  assert.equal(map[clientOperationsPresentationMapKey('row-index-4', 'vat')], undefined);
  assert.deepEqual(parseClientOperationsPresentationMapKey(`${CLIENT_A}::vat`), {
    identity: CLIENT_A,
    columnKey: 'vat',
  });
  assert.deepEqual(resolveClientOperationsPresentationRowIdentity('manual:05'), {
    row_kind: 'manual',
    row_id: 'manual:05',
  });
  assert.equal(resolveClientOperationsPresentationRowIdentity('manual:99'), null);
});

test('clear presentation is a null write; folder and oversized bulk are rejected', () => {
  const cleared = parseClientOperationsCellPresentationWrites([
    { row_kind: 'manual', row_id: 'manual:02', column_key: 'client_name', presentation: null },
  ]);
  assert.equal(cleared[0]?.presentation, null);
  assert.throws(() =>
    parseClientOperationsCellPresentationWrites([
      { row_kind: 'client', row_id: CLIENT_A, column_key: 'folder', presentation: { fill: '#ffffff' } },
    ]),
  );
  assert.throws(() => parseClientOperationsCellPresentationWrites([]));
  assert.throws(() =>
    parseClientOperationsCellPresentationWrites(
      Array.from({ length: CLIENT_OPERATIONS_CELL_PRESENTATION_BULK_MAX + 1 }, () => ({
        row_kind: 'manual',
        row_id: 'manual:01',
        column_key: 'notes',
        presentation: { bold: true },
      })),
    ),
  );
  assert.equal(sanitizeClientOperationsCellPresentation({ fontSize: 13, color: 'red' }), null);
  assert.deepEqual(sanitizeClientOperationsCellPresentation({ fontSize: 14, color: '#ABC' }), {
    color: '#abc',
    fontSize: 14,
  });
});

test('named command, GET-only aggregate attach, RBAC, audit, no generic PATCH', () => {
  assert.equal(CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND, 'set_client_operations_cell_presentation');
  assert.match(commandSource, /CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND/);
  assert.match(commandSource, /setClientOperationsCellPresentationsBulk/);
  assert.match(commandSource, /assertEdit\(ctx\)/);
  assert.match(serviceSource, /assertCanAccessClientFromContext/);
  assert.match(serviceSource, /AUDIT_ACTIONS\.CLIENT_OPERATIONS_CELL_PRESENTATION_SET/);
  assert.match(auditSource, /CLIENT_OPERATIONS_CELL_PRESENTATION_SET: 'client_operations\.cell_presentation\.set'/);
  assert.match(aggregateSource, /user_cell_formatting/);
  assert.match(aggregateSource, /loadClientOperationsCellPresentationsForUser/);
  assert.match(aggregateSource, /Personal formatting is request-scoped/);
  assert.doesNotMatch(incrementalSource, /set_client_operations_cell_presentation/);
  assert.doesNotMatch(commandSource, /method:\s*'PATCH'|generic PATCH/i);
  assert.doesNotMatch(serviceSource, /\.from\('client_operations_cell_presentations'\)[\s\S]{0,200}\.upsert/);
});

test('status-paint remains a separate backend-owned command; decorative fill does not replace it', () => {
  assert.match(commandSource, /set_client_operations_cell_manual_status/);
  assert.match(viewSource, /paintCellManualStatus\(row, column\.key\)/);
  assert.match(viewSource, /background: statusToken \|\| !allowDecorativeFill \? undefined : presentation\?\.fill/);
  assert.match(viewSource, /clientOperationsCellAllowsDecorativeFill/);
  assert.doesNotMatch(serviceSource, /manual_cell_statuses|sent_for_approval/);
});

test('frontend hydrates formatting from aggregate truth, not localStorage write path', () => {
  assert.match(pageSource, /user_cell_formatting/);
  assert.match(pageSource, /hydrateClientOperationsUserCellFormatting/);
  assert.match(pageSource, /userCellFormatting=\{userCellFormatting\}/);
  assert.match(viewSource, /hydrateClientOperationsUserCellFormatting\(userCellFormatting/);
  assert.doesNotMatch(viewSource, /loadClientOperationsCellPresentation\(/);
  assert.doesNotMatch(viewSource, /saveClientOperationsCellPresentation\(/);
  assert.match(commandSource, /reuseMaterializationCache = true/);
});
