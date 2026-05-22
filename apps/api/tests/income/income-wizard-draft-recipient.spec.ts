import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateDraftAgainstDocumentTypeRules } from '../../src/domains/income/income-document-draft.helpers.js';
import type { IncomeAvailableDocumentType } from '../../src/domains/income/income.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const wizardSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);

const quoteDocType: IncomeAvailableDocumentType = {
  key: 'quote',
  label: 'הצעת מחיר',
  enabled: true,
  disabled_reason: null,
  legal_hint: null,
  requires_payment_received: false,
  requires_due_date: false,
  allows_credit: false,
  source: 'fallback_il',
  country_code: 'IL',
  ruleset_id: null,
};

test('validateDraftAgainstDocumentTypeRules: saved income_customer_id clears customer_required', () => {
  const { validation_warnings_json } = validateDraftAgainstDocumentTypeRules(
    {
      document_type: 'quote',
      income_customer_id: '11111111-1111-4111-8111-111111111111',
      one_time_customer_snapshot_json: null,
      draft_lines_json: [],
      payment_terms_json: null,
      due_date: null,
      document_date: '2026-05-21',
      payment_received_json: null,
      notes: null,
      currency: 'ILS',
      language: 'he',
    },
    quoteDocType,
  );
  assert.ok(
    !validation_warnings_json.some((w) => w.code === 'customer_required'),
    'customer_required must not appear when income_customer_id is set',
  );
});

test('validateDraftAgainstDocumentTypeRules: snapshot clears customer_required', () => {
  const { validation_warnings_json } = validateDraftAgainstDocumentTypeRules(
    {
      document_type: 'quote',
      income_customer_id: null,
      one_time_customer_snapshot_json: { display_name: 'NYC' },
      draft_lines_json: [],
      payment_terms_json: null,
      due_date: null,
      document_date: '2026-05-21',
      payment_received_json: null,
      notes: null,
      currency: 'ILS',
      language: 'he',
    },
    quoteDocType,
  );
  assert.ok(
    !validation_warnings_json.some((w) => w.code === 'customer_required'),
    'customer_required must not appear when one_time_customer_snapshot_json is set',
  );
});

test('validationForRow uses draft row customer fields not hardcoded null', () => {
  assert.match(draftEditorSource, /income_customer_id: row\.income_customer_id/);
  assert.match(draftEditorSource, /one_time_customer_snapshot_json: row\.one_time_customer_snapshot_json/);
  assert.doesNotMatch(
    draftEditorSource,
    /income_customer_id: null,\s*\n\s*one_time_customer_snapshot_json: null/,
  );
});

test('begin wizard draft row carries recipient before validation', () => {
  assert.match(draftEditorSource, /income_customer_id: recipient\.income_customer_id/);
  assert.match(
    draftEditorSource,
    /one_time_customer_snapshot_json: recipient\.one_time_customer_snapshot_json/,
  );
});

test('begin_income_wizard_document_draft returns recipient overlay in aggregate response', () => {
  assert.match(commandsSource, /beginIncomeWizardDocumentDraft\(scope, body/);
  assert.match(commandsSource, /wizardDraftCommandResponse\(ctx, command, scope, recipientOverlay, wizardOverlay\)/);
});

test('wizard Next sends income_customer_id or snapshot in begin command body', () => {
  assert.match(wizardSource, /recipientFieldsForBegin/);
  assert.match(wizardSource, /income_customer_id: selected\.income_customer_id/);
  assert.match(wizardSource, /one_time_customer_snapshot_json: selected\.snapshot/);
  assert.match(wizardSource, /beginWizardDraft\(truth\)/);
});
