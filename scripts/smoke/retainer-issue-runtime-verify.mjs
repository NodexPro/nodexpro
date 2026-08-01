/**
 * Runtime verification for Retainer → issue_income_document.
 *
 * Required env:
 *   API_BASE_URL   (default https://nodexpro.onrender.com/api/v1)
 *   AUTH_TOKEN     Bearer JWT
 *   ORG_ID         organization UUID
 *   DRAFT_ID       generated draft UUID to issue
 *
 * Optional:
 *   RECURRING_CYCLE_REVIEW_JSON  stringified recurring_cycle_review object
 *
 * Prints stage PASS/FAIL style result from command response or diagnostic error.
 */
import process from 'node:process';

const API_BASE_URL = (process.env.API_BASE_URL || 'https://nodexpro.onrender.com/api/v1').replace(
  /\/$/,
  '',
);
const AUTH_TOKEN = String(process.env.AUTH_TOKEN || '').trim();
const ORG_ID = String(process.env.ORG_ID || '').trim();
const DRAFT_ID = String(process.env.DRAFT_ID || '').trim();
const reviewRaw = String(process.env.RECURRING_CYCLE_REVIEW_JSON || '').trim();

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

if (!AUTH_TOKEN || !ORG_ID || !DRAFT_ID) {
  fail(
    'Set AUTH_TOKEN, ORG_ID, DRAFT_ID (optional RECURRING_CYCLE_REVIEW_JSON). Refusing to invent credentials.',
  );
}

const healthRes = await fetch(`${API_BASE_URL}/health`);
const health = await healthRes.json().catch(() => ({}));
console.log(
  JSON.stringify(
    { step: 'health', status: healthRes.status, body: health },
    null,
    2,
  ),
);

const body = {
  command: 'issue_income_document',
  draft_id: DRAFT_ID,
};
if (reviewRaw) {
  body.recurring_cycle_review = JSON.parse(reviewRaw);
}

const issueRes = await fetch(`${API_BASE_URL}/income/commands`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH_TOKEN}`,
    'X-Organization-Id': ORG_ID,
  },
  body: JSON.stringify(body),
});
const issueJson = await issueRes.json().catch(() => ({}));
console.log(
  JSON.stringify(
    {
      step: 'issue_income_document',
      status: issueRes.status,
      body: issueJson,
    },
    null,
    2,
  ),
);

if (!issueRes.ok) {
  process.exit(2);
}

const issuedId = issueJson?.meta?.income_document_id || issueJson?.issue_result?.document_id;
const docNumber = issueJson?.issue_result?.document_number;
console.log(
  JSON.stringify(
    {
      step: 'summary',
      issued_document_id: issuedId ?? null,
      document_number: docNumber ?? null,
      idempotent_replay: issueJson?.meta?.idempotent_replay ?? null,
      has_by_type_aggregate: Boolean(
        issueJson?.work_engine_invoices_client_documents_by_type_aggregate,
      ),
      has_review_aggregate: Boolean(
        issueJson?.work_engine_recurring_cycle_draft_review_aggregate,
      ),
    },
    null,
    2,
  ),
);
