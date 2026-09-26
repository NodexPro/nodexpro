/**
 * CO Excel toolbar + 10 user column slots contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX,
  clientOperationsUserSlotKey,
  displayCustomColumnHeaderLabel,
  isBlankCustomColumnLabel,
  isClientOperationsUserSlotKey,
  planClientOperationsUserSlotKeysToCreate,
} from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const commandService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const registryService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
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
const widthsPure = readFileSync(
  join(dir, '../../../web/src/lib/client-operations-column-widths.pure.ts'),
  'utf8',
);

test('11 — max total user/custom columns remains 10', () => {
  assert.equal(CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX, 10);
  assert.equal(planClientOperationsUserSlotKeysToCreate([]).length, 10);
  assert.equal(planClientOperationsUserSlotKeysToCreate(['a', 'b', 'c']).length, 7);
  assert.deepEqual(planClientOperationsUserSlotKeysToCreate(['a', 'b', 'c']), [
    'user_slot_01',
    'user_slot_02',
    'user_slot_03',
    'user_slot_04',
    'user_slot_05',
    'user_slot_06',
    'user_slot_07',
  ]);
});

test('12/14 — existing keys preserved; only remaining capacity filled', () => {
  const existing = ['office_note', 'priority', 'user_slot_01'];
  const planned = planClientOperationsUserSlotKeysToCreate(existing);
  assert.equal(planned.length, 7);
  assert.ok(!planned.includes('user_slot_01'));
  assert.ok(!planned.includes('office_note'));
  assert.deepEqual(planClientOperationsUserSlotKeysToCreate(new Array(10).fill(0).map((_, i) => `k${i}`)), []);
});

test('user_slot keys are stable and recognizable', () => {
  assert.equal(clientOperationsUserSlotKey(1), 'user_slot_01');
  assert.equal(clientOperationsUserSlotKey(10), 'user_slot_10');
  assert.equal(isClientOperationsUserSlotKey('user_slot_05'), true);
  assert.equal(isClientOperationsUserSlotKey('office_note'), false);
  assert.equal(isBlankCustomColumnLabel(' '), true);
  assert.equal(isBlankCustomColumnLabel('הערה'), false);
  assert.equal(displayCustomColumnHeaderLabel(' '), '');
  assert.equal(displayCustomColumnHeaderLabel('הערה'), 'הערה');
});

test('19 — ensure slots is idempotent and create is race-hardened', () => {
  assert.match(commandService, /ensureClientOperationsUserColumnSlots/);
  assert.match(commandService, /ignoreDuplicates:\s*true/);
  assert.match(commandService, /ensure_client_operations_user_column_slots/);
  assert.match(commandService, /latest\.length >= CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX/);
  assert.match(commandService, /23505/);
});

test('PURE READ — listClientOperationsRegistry does not ensure/write slots', () => {
  assert.doesNotMatch(registryService, /ensureClientOperationsUserColumnSlots/);
  assert.match(registryService, /Pure read: user-slot initialization is ONLY via named command/);
  assert.match(commandService, /ensure_client_operations_user_column_slots/);
  assert.match(commandService, /assertEdit\(ctx\)/);
});

test('FE INIT — can_create triggers ensure once; no FE slot math', () => {
  assert.match(pageSource, /userSlotsEnsureRef/);
  assert.match(pageSource, /ensure_client_operations_user_column_slots/);
  assert.match(pageSource, /customColumnsCapability\.can_create/);
  assert.match(pageSource, /userSlotsEnsureRef\.current !== 'idle'/);
  assert.match(pageSource, /userSlotsEnsureRef\.current = 'done'/);
  assert.doesNotMatch(pageSource, /user_slot_0/);
  assert.doesNotMatch(pageSource, /planClientOperationsUserSlotKeysToCreate/);
  assert.doesNotMatch(viewSource, /user_slot_0/);
  assert.doesNotMatch(viewSource, /planClientOperationsUserSlotKeysToCreate/);
});

test('13/15/16 — rename + value commands remain the persistence path', () => {
  assert.match(commandService, /rename_client_operations_custom_column/);
  assert.match(commandService, /labelFromAllowBlank/);
  assert.match(commandService, /set_client_operations_custom_column_value/);
  assert.match(viewSource, /rename_client_operations_custom_column/);
  assert.match(viewSource, /set_client_operations_custom_column_value/);
});

test('18 — custom values have no operational_period_key', () => {
  assert.doesNotMatch(commandService, /custom_column_values[\s\S]{0,200}operational_period_key/);
  assert.match(commandService, /onConflict: 'organization_id,client_id,column_id'/);
});

test('SEARCH — live quiet path; X clears without dimming', () => {
  assert.match(pageSource, /quiet\?:\s*boolean/);
  assert.match(pageSource, /if \(!options\?\.quiet\) setLoading\(true\)/);
  assert.match(viewSource, /onSearchDraftChange/);
  assert.match(viewSource, /applyLiveSearch/);
  assert.match(viewSource, /120/);
  assert.match(viewSource, /quiet:\s*true/);
  assert.match(viewSource, /if \(!value\.trim\(\)\)/);
});

test('TOOLBAR — מיון / סינון / הקפאה / + עמודה hidden from UI', () => {
  assert.match(viewSource, /HIDDEN for now[\s\S]*סינון[\s\S]*מיון/);
  assert.match(viewSource, /הקפאה hidden from toolbar/);
  assert.doesNotMatch(viewSource, />מיון ↑</);
  assert.doesNotMatch(viewSource, />מיון ↓</);
  assert.doesNotMatch(viewSource, />סינון</);
  assert.doesNotMatch(viewSource, />הקפאה</);
  assert.doesNotMatch(viewSource, />\+ עמודה</);
  // Underlying freeze state retained.
  assert.match(viewSource, /freezeOn/);
  assert.match(viewSource, /is-frozen/);
});

test('RESIZE — all headers keep resize handle; localStorage key reused', () => {
  assert.match(viewSource, /nx-co-sheet__resize-handle/);
  assert.match(viewSource, /beginResize/);
  assert.match(viewSource, /clampClientOperationsColumnWidth/);
  assert.match(widthsPure, /nx\.client-operations\.column-widths\.v1/);
  assert.match(widthsPure, /COLUMN_WIDTH_MIN = 48/);
  assert.match(widthsPure, /COLUMN_WIDTH_MAX = 480/);
  assert.doesNotMatch(viewSource, /beginResize[\s\S]{0,80}onRegistryCommand/);
});
