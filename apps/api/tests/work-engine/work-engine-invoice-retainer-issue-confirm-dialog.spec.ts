import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

function readWebSource(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

test('issue confirmation dialog stacks above preview overlay', () => {
  const confirmModalSource = readWebSource('components/work-engine/WorkEngineCycleDraftReviewConfirmModal.tsx');
  const setupModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  assert.ok(confirmModalSource.includes('nx-we-retainer-overlay--above-preview'));
  assert.ok(setupModalSource.includes('nx-we-retainer-preview-overlay--blocked'));
});

test('issue confirmation passes backend issue_month to command', () => {
  const setupModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  assert.ok(setupModalSource.includes('issue_month: issueMonth'));
  assert.ok(setupModalSource.includes('issueMonthSelector'));
  assert.ok(setupModalSource.includes('onConfirm={(issueMonth)'));
});

test('issue command validates issue_month on backend', () => {
  const issueServiceSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-issue.service.ts'),
    'utf8',
  );
  assert.ok(issueServiceSource.includes('parseIssueMonthFromCommandBody'));
  assert.ok(issueServiceSource.includes('assertIssueMonthAllowed'));
  assert.ok(issueServiceSource.includes('resolveIssueDateForIssueMonth'));
});

test('issue month window is resolved via Country Pack resolver in both read and write paths', () => {
  const issueServiceSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-issue.service.ts'),
    'utf8',
  );
  const reviewServiceSource = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts'),
    'utf8',
  );
  const resolverSource = readFileSync(
    join(dir, '../../src/domains/income/income-issue-month-window-resolver.ts'),
    'utf8',
  );
  assert.ok(issueServiceSource.includes('resolveIncomeIssueMonthWindowForOrg'));
  assert.ok(reviewServiceSource.includes('resolveIncomeIssueMonthWindowForOrg'));
  assert.ok(resolverSource.includes('resolveLegalValue'));
  assert.ok(resolverSource.includes('il_income_issue_month_window'));
});

test('review aggregate exposes issue_month_selector on issue actions', () => {
  const actionsSource = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review-actions.pure.ts'),
    'utf8',
  );
  assert.ok(actionsSource.includes('buildIssueMonthSelector'));
  assert.ok(actionsSource.includes('issue_month_selector'));
});
