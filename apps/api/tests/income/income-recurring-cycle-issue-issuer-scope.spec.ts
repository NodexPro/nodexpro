import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertRowMatchesIssuerScope } from '../../src/domains/income/income.guards.js';
import {
  HEBREW_RECURRING_ISSUER_MISMATCH,
  resolveDraftIssuerRepairPlan,
} from '../../src/domains/income/income-recurring-cycle-issue-issuer-scope.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const apiSrcRoot = join(dir, '../../src');
const webSrcRoot = join(dir, '../../../web/src');

function readApi(relativePath: string): string {
  return readFileSync(join(apiSrcRoot, relativePath), 'utf8');
}

function readWeb(relativePath: string): string {
  return readFileSync(join(webSrcRoot, relativePath), 'utf8');
}

const clientA = 'a1111111-1111-4111-8111-111111111111';
const clientB = 'b2222222-2222-4222-8222-222222222222';
const orgIssuer = 'c3333333-3333-4333-8333-333333333333';

const selfScope = {
  org_id: 'o1111111-1111-4111-8111-111111111111',
  actor_user_id: 'u2222222-2222-4222-8222-222222222222',
  acting_mode: 'self' as const,
  issuer_business_id: orgIssuer,
  represented_client_id: null,
  issuer_label: 'Office',
  represented_client_label: null,
  permissions: { view: true, edit: true, issue: true, issue_on_behalf: true },
};

test('repair plan: matching draft identity is ok without repair', () => {
  assert.deepEqual(
    resolveDraftIssuerRepairPlan({
      profileClientId: clientA,
      draftRepresentedClientId: clientA,
      draftIssuerBusinessId: clientA,
    }),
    { kind: 'ok', represented_client_id: clientA, issuer_business_id: clientA },
  );
});

test('repair plan: stale issuer with correct represented client is safely repairable', () => {
  assert.deepEqual(
    resolveDraftIssuerRepairPlan({
      profileClientId: clientA,
      draftRepresentedClientId: clientA,
      draftIssuerBusinessId: orgIssuer,
    }),
    { kind: 'repair', represented_client_id: clientA, issuer_business_id: clientA },
  );
});

test('repair plan: missing represented with correct issuer is safely repairable', () => {
  assert.deepEqual(
    resolveDraftIssuerRepairPlan({
      profileClientId: clientA,
      draftRepresentedClientId: null,
      draftIssuerBusinessId: clientA,
    }),
    { kind: 'repair', represented_client_id: clientA, issuer_business_id: clientA },
  );
});

test('repair plan: wrong represented client is rejected (no cross-client repair)', () => {
  assert.equal(
    resolveDraftIssuerRepairPlan({
      profileClientId: clientA,
      draftRepresentedClientId: clientB,
      draftIssuerBusinessId: clientB,
    }).kind,
    'reject',
  );
});

test('repair plan: missing represented with wrong issuer is rejected', () => {
  assert.equal(
    resolveDraftIssuerRepairPlan({
      profileClientId: clientA,
      draftRepresentedClientId: null,
      draftIssuerBusinessId: clientB,
    }).kind,
    'reject',
  );
});

test('assertRowMatchesIssuerScope remains strict for stale self-mode vs client draft', () => {
  assert.throws(() =>
    assertRowMatchesIssuerScope(selfScope, {
      organization_id: selfScope.org_id,
      issuer_business_id: clientA,
      represented_client_id: clientA,
    }),
  );
});

test('Hebrew mismatch message is prepared for unsafe identity failures', () => {
  assert.match(HEBREW_RECURRING_ISSUER_MISMATCH, /מנפיק/);
  assert.doesNotMatch(HEBREW_RECURRING_ISSUER_MISMATCH, /outside active issuer scope/i);
});

test('issue resolves recurring issuer scope before active-scope draft load', () => {
  const issuePath = join(apiSrcRoot, 'domains/income/income-document-issue.service.ts');
  const issue = readFileSync(issuePath, 'utf8');
  const fnStart = issue.indexOf('export async function executeIssueIncomeDocument');
  assert.ok(fnStart >= 0, `missing executeIssueIncomeDocument in ${issuePath}`);
  const fnBody = issue.slice(fnStart);
  const reviewCtxIdx = fnBody.indexOf('parseRecurringCycleReviewCommandContext(body)');
  const resolveIdx = fnBody.indexOf('resolveAndApplyRecurringCycleIssueIssuerScope(ctx');
  const loadScopeIdx = fnBody.indexOf('loadActiveIncomeIssuerScope(ctx)');
  const loadDraftIdx = fnBody.indexOf('loadFullDraftForIssue(');
  assert.ok(reviewCtxIdx > 0, `missing parse call in executeIssueIncomeDocument`);
  assert.ok(resolveIdx > reviewCtxIdx, `resolve must follow parse`);
  assert.ok(loadScopeIdx > resolveIdx, `active scope must follow resolve`);
  assert.ok(loadDraftIdx > loadScopeIdx, `draft load must follow active scope`);
  assert.ok(fnBody.includes('assertRowMatchesIssuerScope') || issue.includes('assertRowMatchesIssuerScope'));
});

test('ordinary self issue leaves active scope; office draft resolves trusted issuer without FE select', () => {
  const issue = readFileSync(
    join(apiSrcRoot, 'domains/income/income-document-issue.service.ts'),
    'utf8',
  );
  const fnStart = issue.indexOf('export async function executeIssueIncomeDocument');
  assert.ok(fnStart >= 0);
  const block = issue.slice(fnStart, fnStart + 4500);
  assert.match(block, /if \(reviewContext\)/);
  assert.match(block, /resolveAndApplyIssuerScopeFromTrustedOfficeDraftIfNeeded/);
  assert.match(block, /loadActiveIncomeIssuerScope\(ctx\)/);
  assert.match(block, /assertIncomeIssuePermission\(scope\)/);
  assert.ok(issue.includes('assertRowMatchesIssuerScope'));

  const scopeService = readApi('domains/income/income-recurring-cycle-issue-issuer-scope.service.ts');
  assert.match(scopeService, /resolveAndApplyIssuerScopeFromTrustedOfficeDraftIfNeeded/);
  assert.match(scopeService, /trusted_office_draft_issue_issuer_resolve/);
  assert.match(scopeService, /isOfficeDraft/);
});

test('frontend wizard issue sends only issue_income_document + draft_id (no FE issuer select chain)', () => {
  const wizard = readWeb('components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx');
  const start = wizard.indexOf('const handleSaveAndIssue = async');
  const block = wizard.slice(start, start + 900);
  assert.ok(block.includes('issue_document'));
  assert.ok(block.includes('draft_id'));
  assert.ok(!block.includes('select_income_issuer_context'));
  assert.ok(!block.includes('select_issuer'));
});

test('official issuer-context apply is reused (no duplicated select logic)', () => {
  const scopeService = readApi('domains/income/income-recurring-cycle-issue-issuer-scope.service.ts');
  const issuerContext = readApi('domains/income/income-issuer-context.service.ts');
  assert.match(scopeService, /applyOfficialIncomeIssuerContext/);
  assert.match(issuerContext, /export async function applyOfficialIncomeIssuerContext/);
  assert.match(issuerContext, /applySelectIncomeIssuerContext/);
  assert.match(issuerContext, /await applyOfficialIncomeIssuerContext/);
  assert.doesNotMatch(scopeService, /upsertPersistedWorkspace/);
});

test('issue_and_send passes recurring_cycle_review into issue and resolves scope first', () => {
  const source = readApi('domains/income/income-document-issue-and-send.service.ts');
  assert.match(source, /resolveAndApplyRecurringCycleIssueIssuerScope/);
  assert.match(source, /recurring_cycle_review: body\.recurring_cycle_review/);
  const resolveIdx = source.indexOf('resolveAndApplyRecurringCycleIssueIssuerScope');
  const loadScopeIdx = source.indexOf('loadActiveIncomeIssuerScope(ctx)');
  assert.ok(resolveIdx > 0 && loadScopeIdx > resolveIdx);
});

test('review aggregate returns issuer_context and prepares official office context on open', () => {
  const review = readApi(
    'domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts',
  );
  assert.match(review, /issuer_context/);
  assert.match(review, /buildRecurringCycleIssuerContextTruth/);
  assert.match(review, /prepareRecurringCycleReviewIssuerScope/);
  assert.match(review, /open_recurring_cycle_draft_for_review/);
});

test('frontend cycle issue sends only issue_income_document with recurring_cycle_review', () => {
  const setup = readWeb('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  const issueFn = setup.indexOf('const runCycleDraftIssue = useCallback');
  const block = setup.slice(issueFn, issueFn + 2200);
  assert.ok(block.includes('income_commands.issue_document'));
  assert.ok(block.includes('recurring_cycle_review'));
  assert.ok(!block.includes('select_income_issuer_context'));
});

test('migration 151 user_saved_at contract remains present', () => {
  const migration = readFileSync(
    join(dir, '../../../../supabase/migrations/151_income_document_drafts_user_saved_at.sql'),
    'utf8',
  );
  assert.match(migration, /user_saved_at/);
  assert.match(migration, /generated_draft_id/);
});
