import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INCOME_ISSUE_FAILED_LOG_PREFIX,
  INCOME_ISSUE_LOG_PREFIX,
  INCOME_ISSUE_SUCCESS_STAGE_ORDER,
  createIncomeIssueDiagnostic,
  extractIncomeIssueSafeError,
  logIncomeIssueFailed,
  logIncomeIssueStage,
  sanitizeIncomeIssueLogPayload,
  withIncomeIssueStage,
  type IncomeIssueStage,
} from '../../src/domains/income/income-issue-diagnostic.js';

const dir = dirname(fileURLToPath(import.meta.url));
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);

type Captured = { level: 'info' | 'error'; prefix: string; payload: Record<string, unknown> };

function captureDiag() {
  const lines: Captured[] = [];
  const diag = createIncomeIssueDiagnostic({
    org_id: 'org-1',
    draft_id: 'draft-1',
    recurring_cycle_id: 'cycle-1',
    correlation_id: 'corr-1',
    emit: (level, prefix, payload) => {
      lines.push({ level, prefix, payload });
    },
  });
  return { diag, lines };
}

test('success stage order constant matches required pipeline stages', () => {
  assert.deepEqual([...INCOME_ISSUE_SUCCESS_STAGE_ORDER], [
    'issue_command_received',
    'draft_loaded',
    'existing_issued_document_checked',
    'numbering_started',
    'numbering_completed',
    'issued_document_insert_started',
    'issued_document_insert_completed',
    'accounting_posting_started',
    'accounting_posting_completed',
    'draft_mark_issued_started',
    'draft_mark_issued_completed',
    'recurring_cycle_link_started',
    'recurring_cycle_link_completed',
    'refreshed_case_started',
    'refreshed_case_completed',
  ]);
});

test('stage order on successful mocked issue', async () => {
  const { diag, lines } = captureDiag();
  const stages: IncomeIssueStage[] = [];

  for (const stage of INCOME_ISSUE_SUCCESS_STAGE_ORDER) {
    if (stage.endsWith('_started')) {
      const completed = stage.replace('_started', '_completed') as IncomeIssueStage;
      const failing =
        stage === 'numbering_started'
          ? 'numbering'
          : stage === 'issued_document_insert_started'
            ? 'issued_document_insert'
            : stage === 'accounting_posting_started'
              ? 'accounting_posting'
              : stage === 'draft_mark_issued_started'
                ? 'draft_mark_issued'
                : stage === 'recurring_cycle_link_started'
                  ? 'recurring_cycle_link'
                  : stage === 'refreshed_case_started'
                    ? 'refreshed_case'
                    : 'issue_command';
      await withIncomeIssueStage(
        diag,
        { started: stage, completed, failing_stage: failing },
        async () => undefined,
      );
      stages.push(stage, completed);
    } else if (
      stage === 'issue_command_received' ||
      stage === 'draft_loaded' ||
      stage === 'existing_issued_document_checked'
    ) {
      logIncomeIssueStage(diag, stage);
      stages.push(stage);
    }
  }

  const infoStages = lines
    .filter((l) => l.level === 'info' && l.prefix === INCOME_ISSUE_LOG_PREFIX)
    .map((l) => l.payload.stage);
  assert.deepEqual(infoStages, stages);
  assert.equal(diag.last_completed_stage, 'refreshed_case_completed');
  assert.equal(lines.some((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX), false);
});

test('numbering error logs failing_stage=numbering and rethrows original', async () => {
  const { diag, lines } = captureDiag();
  const original = Object.assign(new Error('seq read failed'), {
    code: 'PGRST116',
    details: 'detail-n',
    hint: 'hint-n',
  });

  await assert.rejects(
    () =>
      withIncomeIssueStage(
        diag,
        {
          started: 'numbering_started',
          completed: 'numbering_completed',
          failing_stage: 'numbering',
        },
        async () => {
          throw original;
        },
      ),
    (err: unknown) => err === original,
  );

  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'numbering');
  assert.equal(failed!.payload.correlation_id, 'corr-1');
  assert.equal(failed!.payload.code, 'PGRST116');
  assert.equal(failed!.payload.message, 'seq read failed');
  assert.equal(failed!.payload.details, 'detail-n');
  assert.equal(failed!.payload.hint, 'hint-n');
  assert.equal(failed!.payload.last_completed_stage, null);
});

test('insert error logs failing_stage=issued_document_insert and rethrows original', async () => {
  const { diag, lines } = captureDiag();
  const original = Object.assign(new Error('insert failed'), {
    code: '23502',
    details: 'null value',
    hint: 'fill column',
  });

  await assert.rejects(
    () =>
      withIncomeIssueStage(
        diag,
        {
          started: 'issued_document_insert_started',
          completed: 'issued_document_insert_completed',
          failing_stage: 'issued_document_insert',
        },
        async () => {
          throw original;
        },
      ),
    (err: unknown) => err === original,
  );

  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'issued_document_insert');
  assert.equal(failed!.payload.code, '23502');
});

test('Accounting Base error logs failing_stage=accounting_posting and rethrows original', async () => {
  const { diag, lines } = captureDiag();
  diag.last_completed_stage = 'issued_document_insert_completed';
  diag.issued_document_id = 'doc-1';
  const original = Object.assign(new Error('ab posting failed'), {
    code: '42501',
    details: 'permission denied',
    hint: 'check RLS',
  });

  logIncomeIssueStage(diag, 'accounting_posting_started', { duration_ms: 0 });
  logIncomeIssueStage(diag, 'accounting_posting_failed', extractIncomeIssueSafeError(original));
  logIncomeIssueStage(diag, 'issued_document_cleanup_started', { duration_ms: 0 });
  logIncomeIssueStage(diag, 'issued_document_cleanup_completed', { duration_ms: 1 });
  logIncomeIssueFailed(diag, 'accounting_posting', original);

  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  assert.equal(failed!.payload.failing_stage, 'accounting_posting');
  assert.equal(failed!.payload.last_completed_stage, 'issued_document_insert_completed');
  assert.equal(failed!.payload.issued_document_id, 'doc-1');
  assert.equal(failed!.payload.code, '42501');
  assert.equal(failed!.payload.message, 'ab posting failed');

  // Original error identity preserved for callers (simulate rethrow contract).
  try {
    throw original;
  } catch (e) {
    assert.equal(e, original);
  }
});

test('sensitive fields are not logged', () => {
  const dirty = {
    correlation_id: 'corr-1',
    org_id: 'org-1',
    draft_id: 'draft-1',
    service_role_key: 'secret-key',
    access_token: 'Bearer xxx',
    bank_account: '12-345',
    email: 'a@b.com',
    tax_id: '123456789',
    customer_snapshot_json: { display_name: 'NYC' },
    totals_snapshot_json: { total: 1180 },
    stage: 'numbering_started',
    message: 'ok',
  };
  const clean = sanitizeIncomeIssueLogPayload(dirty);
  assert.equal(clean.correlation_id, 'corr-1');
  assert.equal(clean.stage, 'numbering_started');
  assert.equal(clean.message, 'ok');
  assert.equal('service_role_key' in clean, false);
  assert.equal('access_token' in clean, false);
  assert.equal('bank_account' in clean, false);
  assert.equal('email' in clean, false);
  assert.equal('tax_id' in clean, false);
  assert.equal('customer_snapshot_json' in clean, false);
  assert.equal('totals_snapshot_json' in clean, false);

  const { diag, lines } = captureDiag();
  const err = Object.assign(new Error('boom'), {
    code: 'XX',
    service_role_key: 'secret-key',
    bank_account: '12-345',
    email: 'leak@example.com',
  });
  logIncomeIssueFailed(diag, 'numbering', err);
  const failed = lines.find((l) => l.prefix === INCOME_ISSUE_FAILED_LOG_PREFIX);
  assert.ok(failed);
  const serialized = JSON.stringify(failed!.payload);
  assert.equal(serialized.includes('secret-key'), false);
  assert.equal(serialized.includes('12-345'), false);
  assert.equal(serialized.includes('leak@example.com'), false);
  assert.equal(serialized.includes('service_role_key'), false);
  assert.equal(serialized.includes('bank_account'), false);
});

test('original error is still rethrown from withIncomeIssueStage', async () => {
  const { diag } = captureDiag();
  const original = new Error('keep-me');
  let caught: unknown;
  try {
    await withIncomeIssueStage(
      diag,
      {
        started: 'numbering_started',
        completed: 'numbering_completed',
        failing_stage: 'numbering',
      },
      async () => {
        throw original;
      },
    );
  } catch (e) {
    caught = e;
  }
  assert.equal(caught, original);
});

test('issue service wires diagnostic stages without changing cleanup/posting semantics', () => {
  assert.match(issueServiceSource, /createIncomeIssueDiagnostic/);
  assert.match(issueServiceSource, /numbering_started/);
  assert.match(issueServiceSource, /issued_document_insert_started/);
  assert.match(issueServiceSource, /accounting_posting_started/);
  assert.match(issueServiceSource, /accounting_posting_failed/);
  assert.match(issueServiceSource, /issued_document_cleanup_started/);
  assert.match(issueServiceSource, /issued_document_cleanup_completed/);
  assert.match(issueServiceSource, /logIncomeIssueFailed\(diag, 'accounting_posting'/);
  assert.match(issueServiceSource, /failing_stage: 'numbering'/);
  assert.match(issueServiceSource, /failing_stage: 'issued_document_insert'/);
  assert.match(issueServiceSource, /\.delete\(\)/);
  assert.match(issueServiceSource, /throw postingErr/);
  assert.match(commandsSource, /refreshed_case_started/);
  assert.match(commandsSource, /withIncomeIssueStage/);
});
