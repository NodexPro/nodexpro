import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertRowMatchesIssuerScope } from '../../src/domains/income/income.guards.js';
import {
  assertDraftReadyToIssue,
  formatIncomeDocumentNumber,
  buildLegalSnapshotForIssue,
  buildTotalsSnapshotForIssue,
} from '../../src/domains/income/income-document-issue.pure.js';
import { buildAvailableDocumentTypesForBusiness } from '../../src/domains/income/income-document-types.fallback.js';

const dir = dirname(fileURLToPath(import.meta.url));
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const numberingSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-numbering.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);

const selfScope = {
  org_id: 'a1111111-1111-4111-8111-111111111111',
  actor_user_id: 'b2222222-2222-4222-8222-222222222222',
  acting_mode: 'self' as const,
  issuer_business_id: 'c3333333-3333-4333-8333-333333333333',
  represented_client_id: null,
  issuer_label: 'Office',
  represented_client_label: null,
  permissions: { view: true, edit: true, issue: true, issue_on_behalf: true },
};

test('cannot issue cancelled draft', () => {
  assert.throws(() =>
    assertDraftReadyToIssue({
      status: 'cancelled',
      document_type: 'receipt',
      income_customer_id: 'd1111111-1111-4111-8111-111111111111',
      one_time_customer_snapshot_json: null,
      draft_lines_json: [{ amount_reference: 100 }],
    }),
  );
});

test('cannot issue draft without lines', () => {
  assert.throws(() =>
    assertDraftReadyToIssue({
      status: 'draft',
      document_type: 'receipt',
      income_customer_id: 'd1111111-1111-4111-8111-111111111111',
      one_time_customer_snapshot_json: null,
      draft_lines_json: [],
    }),
  );
});

test('cannot issue disabled document type (tax_invoice for osek_patur)', () => {
  const available = buildAvailableDocumentTypesForBusiness('osek_patur');
  const tax = available.find((t) => t.key === 'tax_invoice');
  assert.equal(tax?.enabled, false);
});

test('issue allocates backend document number format', () => {
  assert.equal(formatIncomeDocumentNumber(2026, 1, null), '2026-0001');
  assert.equal(formatIncomeDocumentNumber(2026, 42, 'INV-'), 'INV-42');
});

test('issued snapshots mark non-financial-truth preview only', () => {
  const totals = buildTotalsSnapshotForIssue({ subtotal_reference: 100 }, 'ILS', 2);
  assert.equal(totals.not_financial_truth, true);
  assert.equal(totals.not_accounting_base_truth, true);
  assert.equal(totals.accounting_base_post_pending, true);
});

test('legal snapshot includes country pack boundary fields', () => {
  const available = buildAvailableDocumentTypesForBusiness('osek_murshe');
  const docType = available.find((t) => t.key === 'tax_invoice')!;
  const legal = buildLegalSnapshotForIssue({
    country_code: 'IL',
    ruleset_id: null,
    document_type: 'tax_invoice',
    docType,
    business_type: 'osek_murshe',
    business_type_raw: 'registered_dealer',
    warnings: [],
  });
  assert.equal(legal.country_code, 'IL');
  assert.equal(legal.document_type_source, 'fallback_il');
  assert.equal(legal.business_type, 'osek_murshe');
});

test('draft from wrong issuer context fails scope guard', () => {
  assert.throws(() =>
    assertRowMatchesIssuerScope(selfScope, {
      organization_id: selfScope.org_id,
      issuer_business_id: 'd4444444-4444-4444-8444-444444444444',
      represented_client_id: null,
    }),
  );
});

test('issue command wired and returns workspace aggregate', () => {
  assert.match(commandsSource, /INCOME_COMMAND_ISSUE_DOCUMENT/);
  assert.match(commandsSource, /executeIssueIncomeDocument/);
  assert.match(commandsSource, /income_workspace_aggregate: await buildIncomeWorkspaceAggregate/);
});

test('numbering uses backend IL series policy only', () => {
  assert.match(numberingSource, /income-document-numbering-policy/);
  assert.match(numberingSource, /IL_NUMBERING_POLICY_KEY/);
  assert.match(numberingSource, /computeNextIlSeriesNumber/);
  assert.doesNotMatch(numberingSource, /document_number.*\+.*1/);
});

test('issue service uses income accounting boundary not direct accounting-base tables', () => {
  assert.match(issueServiceSource, /income-accounting-posting\.service/);
  assert.doesNotMatch(issueServiceSource, /from\s+['"].*\/accounting-base\//);
  assert.doesNotMatch(issueServiceSource, /from\s+['"].*docflow/i);
});

test('issue service emits Work Engine work_events via bridge only', () => {
  assert.match(issueServiceSource, /emitIncomeWorkEventsAfterDocumentIssued/);
  assert.match(issueServiceSource, /income-work-engine-bridge/);
  assert.doesNotMatch(issueServiceSource, /\.from\(['"]work_items['"]\)/);
});
