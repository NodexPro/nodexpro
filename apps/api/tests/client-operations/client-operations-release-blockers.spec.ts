/**
 * Release blockers: GET case read-only, Owner Calendar due dates,
 * notes named commands, reminders Stage 3 ACL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vatPeriodIdentityForSelectedPeriod } from '../../src/domains/client-operations/client-operations-reporting-due.pure.js';
import { filterAuthorizedClientIds } from '../../src/domains/client-operations/organization-client-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(dir, '../../src/domains', rel), 'utf8');
const web = (rel: string) => readFileSync(join(dir, '../../../web/src', rel), 'utf8');

const caseService = src('client-operations/client-operations.service.ts');
const documents = src('client-operations/client-documents-tab.service.ts');
const obligations = src('client-operations/client-obligations-tasks-core.service.ts');
const taxSettings = src('client-operations/client-tax-settings.service.ts');
const annual = src('client-operations/client-annual-report-tab.service.ts');
const notes = src('client-operations/client-operations-notes.service.ts');
const routes = src('client-operations/client-operations.routes.ts');
const dueService = src('client-operations/client-operations-reporting-due.service.ts');
const view = web('components/client-operations/ClientOperationsRegistryView.tsx');
const endpoints = web('api/endpoints.ts');
const remindersUi = web('components/ReminderToasts.tsx');

test('GET case is read-only — no recompute, no document writes', () => {
  const fnStart = caseService.indexOf('export async function getClientOperationsCase');
  assert.ok(fnStart > 0);
  const fn = caseService.slice(fnStart, fnStart + 8000);
  assert.doesNotMatch(fn, /recomputeClientObligationsAndTasks/);
  assert.match(fn, /readOnly:\s*true/);
  assert.match(fn, /skipEnsureDefaultFolders:\s*true/);
  assert.match(fn, /getAnnualTabReadModel\(ctx, clientId, undefined, \{ readOnly: true \}\)/);
  assert.match(fn, /getPayrollTabReadModel\(ctx, clientId, \{ readOnly: true \}\)/);
  assert.match(documents, /readOnly\?: boolean/);
  assert.match(documents, /if \(options\?\.readOnly\)/);
  assert.doesNotMatch(fn, /ensureDocumentProfile/);
  assert.doesNotMatch(fn, /ensureClientDocumentFolders/);
});

test('night pass and obligation commands still recompute', () => {
  assert.match(obligations, /export async function recomputeClientObligationsAndTasks/);
  assert.match(obligations, /recomputeClientObligationsAndTasksForOrg/);
});

test('Owner Calendar is the only VAT/advance/deductions due-date source', () => {
  assert.match(dueService, /resolveReportingDueDatesBatch/);
  assert.match(dueService, /resolveClientVatReportingDueDate/);
  assert.match(caseService, /resolveVatDueDisplayByClientForRegistry/);
  assert.match(taxSettings, /resolveVatDueDisplayForCurrentRelevantPeriod/);
  assert.match(obligations, /resolveOfficialFilingDueDateIso/);
  assert.doesNotMatch(obligations, /vatDueDateFromPeriod/);
  assert.doesNotMatch(obligations, /annualDueDate/);
  assert.doesNotMatch(annual, /05-31/);
  assert.match(annual, /לא הוגדר/);
  assert.doesNotMatch(taxSettings, /computeNextVatDivuachDueDate/);
});

test('VAT period identity — monthly and bi-monthly 2026', () => {
  assert.equal(vatPeriodIdentityForSelectedPeriod('monthly', '2026-03'), '2026-03');
  assert.equal(vatPeriodIdentityForSelectedPeriod('monthly', '2026-04'), '2026-04');
  assert.equal(vatPeriodIdentityForSelectedPeriod('bi_monthly', '2026-03'), '2026-03');
  assert.equal(vatPeriodIdentityForSelectedPeriod('bi_monthly', '2026-04'), '2026-03');
  assert.equal(vatPeriodIdentityForSelectedPeriod('bi_monthly', '2026-01'), '2026-01');
  assert.equal(vatPeriodIdentityForSelectedPeriod('bi_monthly', '2026-02'), '2026-01');
  assert.equal(vatPeriodIdentityForSelectedPeriod('not_relevant', '2026-03'), null);
  assert.equal(vatPeriodIdentityForSelectedPeriod(null, '2026-03'), null);
});

test('notes use named commands, caller query, and audit', () => {
  assert.match(routes, /operational-notes\/commands\/create_note/);
  assert.match(routes, /operational-notes\/:noteId\/commands\/delete_note/);
  assert.match(routes, /operational-notes\/:noteId\/commands\/update_note/);
  assert.match(notes, /parseRegistryQueryInput\(body\.query\)/);
  assert.match(notes, /listClientOperationsRegistry\(ctx, registryQuery\)/);
  assert.doesNotMatch(notes, /listClientOperationsRegistry\(ctx,\s*\{\}\)/);
  assert.match(notes, /CLIENT_OPERATIONS_NOTE_CREATED/);
  assert.match(notes, /CLIENT_OPERATIONS_NOTE_UPDATED/);
  assert.match(notes, /CLIENT_OPERATIONS_NOTE_DELETED/);
  assert.match(notes, /assertCanAccessClientFromContext/);
  assert.match(endpoints, /commands\/create_note/);
  assert.match(endpoints, /commands\/delete_note/);
  assert.match(view, /moduleClientOperationsCreateNote/);
  assert.match(view, /moduleClientOperationsDeleteNote/);
  assert.match(view, /query: query \?\? \{\}/);
});

test('reminders are backend-authorized; UI does not compute due with Date.now', () => {
  assert.match(notes, /filterAuthorizedClientIds\(accessScope, clientIds\)/);
  assert.match(notes, /resolveOrganizationClientAccessScopeFromContext/);
  assert.doesNotMatch(remindersUi, /Date\.now\(\)/);
  const staff = {
    organization_id: 'org',
    viewer_user_id: 'u1',
    role_code: 'staff',
    kind: 'ASSIGNED_TO_SELF' as const,
    access_scope_key: 'ASSIGNED:u1',
    authorized_client_ids: ['allowed'],
  };
  assert.deepEqual(filterAuthorizedClientIds(staff, ['allowed', 'denied']), ['allowed']);
  const office = {
    organization_id: 'org',
    viewer_user_id: 'owner',
    role_code: 'owner',
    kind: 'OFFICE' as const,
    access_scope_key: 'OFFICE',
    authorized_client_ids: null,
  };
  assert.deepEqual(filterAuthorizedClientIds(office, ['a', 'b']), ['a', 'b']);
});
