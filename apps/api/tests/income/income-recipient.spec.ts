import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseRecipientInputBody,
  validateRecipientInputFields,
  buildRecipientSnapshotJson,
  recipientDisplayLine,
} from '../../src/domains/income/income-recipient.validation.js';

const dir = dirname(fileURLToPath(import.meta.url));
const recipientService = readFileSync(
  join(dir, '../../src/domains/income/income-recipient.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const workspaceAggSource = readFileSync(
  join(dir, '../../src/domains/income/income-workspace-aggregate.service.ts'),
  'utf8',
);
const weBuilderSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-document-creation.builders.ts'),
  'utf8',
);
const wizardSource = readFileSync(
  join(
    dir,
    '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx',
  ),
  'utf8',
);

test('recipient search scopes to issuer via organization_id issuer_business_id represented_client_id', () => {
  assert.match(recipientService, /eq\('issuer_business_id', scope\.issuer_business_id\)/);
  assert.match(recipientService, /eq\('organization_id', scope\.org_id\)/);
  assert.match(recipientService, /represented_client_id/);
  assert.match(recipientService, /\.eq\('is_one_time', false\)/);
});

test('save for future inserts income_customer not core clients', () => {
  assert.match(recipientService, /\.from\('income_customers'\)/);
  assert.doesNotMatch(recipientService, /\.from\(['"]clients['"]\)/);
  assert.match(recipientService, /is_one_time: false/);
});

test('set snapshot does not insert income_customer in service layer', () => {
  assert.match(recipientService, /selectedFromInputFields/);
  assert.match(recipientService, /buildRecipientSnapshotJson/);
});

test('one-time snapshot has no income_customer_id in selected model', () => {
  const fields = parseRecipientInputBody({
    display_name: 'Buyer Ltd',
    tax_id: '514123456',
  });
  const snap = buildRecipientSnapshotJson(fields);
  assert.equal(snap.display_name, 'Buyer Ltd');
  assert.ok(!('income_customer_id' in snap));
});

test('validation requires display name', () => {
  const errors = validateRecipientInputFields(
    parseRecipientInputBody({ display_name: '', email: 'bad' }),
  );
  assert.ok(errors.display_name);
});

test('income commands return full workspace aggregate with recipient overlay', () => {
  assert.match(commandsSource, /INCOME_COMMAND_SEARCH_RECIPIENTS/);
  assert.match(commandsSource, /INCOME_COMMAND_SELECT_RECIPIENT/);
  assert.match(commandsSource, /INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT/);
  assert.match(commandsSource, /INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE/);
  assert.match(commandsSource, /buildIncomeWorkspaceAggregate\(ctx, scope, overlay\)/);
  assert.match(commandsSource, /income_workspace_aggregate/);
});

test('workspace aggregate includes recipient_search model', () => {
  assert.match(workspaceAggSource, /buildIncomeRecipientSearchModel/);
  assert.match(workspaceAggSource, /recipient_search,/);
});

test('work engine wizard schema wires recipient search commands', () => {
  assert.match(weBuilderSource, /search_income_recipients/);
  assert.match(weBuilderSource, /select_income_recipient/);
  assert.match(weBuilderSource, /set_income_recipient_snapshot/);
  assert.match(weBuilderSource, /save_income_recipient_for_future/);
  assert.doesNotMatch(weBuilderSource, /create_one_time_income_customer/);
});

test('work engine wizard UI has no customer_mode step', () => {
  assert.doesNotMatch(wizardSource, /customer_mode/);
  assert.doesNotMatch(wizardSource, /לקוח חד-פעמי/);
  assert.doesNotMatch(wizardSource, /לקוח קיים/);
  assert.match(wizardSource, /recipient_search/);
});

test('recipient display line is backend formatted', () => {
  const line = recipientDisplayLine({
    display_name: 'Acme',
    tax_id: '123',
    phone: '050',
    email: 'a@b.co',
  });
  assert.match(line, /Acme/);
  assert.match(line, /123/);
});

test('recipient search quotes PostgREST or filter values', () => {
  assert.match(recipientService, /quotePostgrestFilterValue/);
  assert.match(recipientService, /display_name\.ilike\.\$\{pattern\}/);
});

test('select_income_recipient returns not-found AppError code when row missing', () => {
  assert.match(commandsSource, /INCOME_RECIPIENT_NOT_FOUND/);
  assert.match(commandsSource, /loadIncomeRecipientById/);
  assert.match(commandsSource, /selectedFromSavedRow\(row\)/);
});

test('supabase errors are mapped in recipient and workspace aggregate services', () => {
  assert.match(recipientService, /throwIfSupabaseError/);
  assert.match(workspaceAggSource, /throwIfSupabaseError/);
});
