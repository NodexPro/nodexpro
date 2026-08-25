/**
 * Canonical recipient persistence for WE general new-document flow + Ord repair migration.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const recipientService = readFileSync(
  join(dir, '../../src/domains/income/income-recipient.service.ts'),
  'utf8',
);
const weRecipientUi = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineRecipientSearchField.tsx'),
  'utf8',
);
const wizardSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const conversionSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-conversion.service.ts'),
  'utf8',
);
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const migration168 = readFileSync(
  join(dir, '../../../../supabase/migrations/168_income_ord_test3_customer_relationship_repair.sql'),
  'utf8',
);
const migration167 = readFileSync(
  join(dir, '../../../../supabase/migrations/167_income_client_panel_stats_office_to_client_scope.sql'),
  'utf8',
);

test('1/6 — set_income_recipient_snapshot persists canonical income_customer (no snapshot-only selected)', () => {
  const setBlockStart = commandsSource.indexOf(
    'if (command === INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT)',
  );
  assert.ok(setBlockStart >= 0);
  const setBlock = commandsSource.slice(setBlockStart, setBlockStart + 1800);
  assert.match(setBlock, /insertSavedIncomeRecipient/);
  assert.match(setBlock, /selectedFromSavedRow\(row\)/);
  assert.doesNotMatch(setBlock, /selectedFromInputFields/);
  assert.match(setBlock, /is_one_time: false/);
});

test('2 — save_income_recipient_for_future still inserts income_customers', () => {
  assert.match(commandsSource, /INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE/);
  assert.match(recipientService, /is_one_time: false/);
  assert.match(recipientService, /\.from\('income_customers'\)/);
});

test('3 — WE create path always uses save_recipient_for_future (not checkbox snapshot branch)', () => {
  assert.match(weRecipientUi, /cmds\.save_recipient_for_future/);
  assert.match(weRecipientUi, /always persist/);
  assert.doesNotMatch(weRecipientUi, /saveForFuture \? cmds\.save_recipient_for_future/);
  assert.doesNotMatch(weRecipientUi, /createValues\.save_for_future === 'true'/);
  assert.doesNotMatch(weRecipientUi, /nx-we-recipient-search__checkbox/);
  assert.match(weRecipientUi, /selected\.kind !== 'saved'/);
});

test('4 — create schema has no save_for_future checkbox; save_for_future_available is false', () => {
  assert.doesNotMatch(recipientService, /key: 'save_for_future'/);
  assert.match(recipientService, /save_for_future_available: false/);
});

test('5 — email alone is not used for recipient dedupe/merge on insert', () => {
  const insertFn = recipientService.slice(
    recipientService.indexOf('export async function insertSavedIncomeRecipient'),
    recipientService.indexOf('export async function insertSavedIncomeRecipient') + 1200,
  );
  assert.doesNotMatch(insertFn, /\.eq\('email'/);
  assert.doesNotMatch(insertFn, /ilike.*email|email.*ilike/);
  assert.match(insertFn, /\.insert\(/);
});

test('6 — represented-client scope applied on customer queries', () => {
  assert.match(recipientService, /eq\('represented_client_id', scope\.represented_client_id\)/);
  assert.match(recipientService, /eq\('issuer_business_id', scope\.issuer_business_id\)/);
});

test('7/8 — begin draft uses income_customer_id for saved recipient; conversion copies income_customer_id', () => {
  assert.match(wizardSource, /income_customer_id: selected\.income_customer_id/);
  assert.match(conversionSource, /income_customer_id: source\.income_customer_id/);
});

test('9/10 — issue persists draft.income_customer_id onto issued document', () => {
  assert.match(issueSource, /income_customer_id: draft\.income_customer_id/);
  assert.match(issueSource, /source: 'income_customer'|source: 'one_time_snapshot'/);
});

test('11/12 — migration 168 creates one Ord customer and links only 1000/2000/2001', () => {
  assert.match(migration168, /366588544/);
  assert.match(migration168, /8b1a4555-4359-48a9-83f1-804d6d4473b3/);
  assert.match(migration168, /31e8d298-054d-49c0-86c4-1b9045500f8e/);
  assert.match(migration168, /document_number = '1000'/);
  assert.match(migration168, /'2000', '2001'/);
  assert.match(migration168, /is_one_time = false/);
  assert.match(migration168, /one_time_snapshot/);
  assert.match(migration168, /set income_customer_id = v_customer_id/);
  assert.match(migration168, /customer_snapshot_json is not distinct from NEW\.customer_snapshot_json/);
});

test('13 — migration 168 restores immutability; does not edit 167', () => {
  assert.match(migration168, /Restore immutability to migration 164/);
  assert.equal((migration168.match(/create or replace function public\.income_documents_immutable_after_issue/g) ?? []).length, 2);
  assert.doesNotMatch(migration167, /אורד|366588544|168_/);
  assert.doesNotMatch(migration168, /income_client_document_management_panel_stats/);
});

test('14/15 — repair does not invent office→Test3 counters; end-customer link uses income_customer_id', () => {
  assert.match(migration168, /acting_mode = 'office_representative'/);
  assert.match(migration168, /income_customer_id is null/);
  assert.doesNotMatch(migration168, /panel_stats/);
});

test('16 — no FE customer insert / local id fabrication', () => {
  assert.doesNotMatch(weRecipientUi, /\.from\(['"]income_customers['"]\)/);
  assert.doesNotMatch(weRecipientUi, /crypto\.randomUUID\(\).*income_customer/);
  assert.match(weRecipientUi, /executeIncomeCommand\(command/);
});
